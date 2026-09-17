import { test, expect, type Page } from '@playwright/test';
import path from 'path';

const BASE_URL = 'https://designforge-ui.com';
const PRODUCTS_URL = `${BASE_URL}/Atlobni/ar/products`;
const OFFERS_URL = `${BASE_URL}/Atlobni/ar/offers`;
const AUTH_STATE = path.join(__dirname, '..', '..', 'auth.json');
const TEST_IMAGE = path.join(__dirname, '..', 'products', 'fixtures', 'qa-test-image.png');

const CATEGORY_NAME = 'امريكي';

const PRODUCT_PRICE = '100';
const OFFER_ORIGINAL_PRICE = '100';
const OFFER_DISCOUNT_AMOUNT = '25';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function deleteProductIfPresent(page: Page, name: string): Promise<void> {
  const deleteButton = page.getByRole('button', { name: `حذف ${name}`, exact: true });
  if ((await deleteButton.count()) === 0) return;

  await deleteButton.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();

  const [deleteResponse] = await Promise.all([
    page.waitForResponse(
      (res) => res.request().method() === 'DELETE' && /\/api\/store\/v1\/products\/\d+$/.test(res.url()),
    ),
    dialog.getByRole('button', { name: 'تأكيد الحذف', exact: true }).click(),
  ]);
  const deleteBody = await deleteResponse.json();
  expect(deleteResponse.ok(), `Product delete HTTP status was ${deleteResponse.status()}`).toBeTruthy();
  expect(deleteBody.code, `Product delete failed: ${deleteBody.message}`).toBe(200);

  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
}

async function deleteOfferIfPresent(page: Page, name: string): Promise<void> {
  const deleteButton = page.getByRole('button', { name: `حذف ${name}`, exact: true });
  if ((await deleteButton.count()) === 0) return;

  await deleteButton.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();

  const [deleteResponse] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'DELETE' && res.url().includes('/offers/')),
    dialog.getByRole('button', { name: 'تأكيد الحذف', exact: true }).click(),
  ]);
  const deleteBody = await deleteResponse.json();
  expect(deleteResponse.ok(), `Offer delete HTTP status was ${deleteResponse.status()}`).toBeTruthy();
  expect(deleteBody.code, `Offer delete failed: ${deleteBody.message}`).toBe(200);

  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
}

test.describe('Product availability -> active offer behavior (STR-17, safe, self-cleaning)', () => {
  test.use({ storageState: AUTH_STATE });

  let productName: string;
  let offerName: string;

  test.beforeEach(() => {
    const ts = Date.now();
    productName = `QA Test Product ${ts}`;
    offerName = `QA Test Offer ${ts}`;
  });

  test.afterEach(async ({ page }) => {
    try {
      await page.goto(OFFERS_URL, { waitUntil: 'networkidle' });
      await deleteOfferIfPresent(page, offerName);
    } catch {
      // best-effort
    }
    try {
      await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
      await deleteProductIfPresent(page, productName);
    } catch {
      // best-effort
    }
  });

  test('Making the linked product unavailable does not auto-modify its active offer (STR-17)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const networkIssues: string[] = [];
    page.on('response', (res) => {
      if (res.status() >= 400) networkIssues.push(`HTTP ${res.status()} ${res.url()}`);
    });

    await test.step('Create a QA product', async () => {
      await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'إضافة منتج', exact: true }).click();
      await page.locator('input[name="name"]').fill(productName);
      await page.locator('#product-category').click();
      await page.getByRole('option', { name: CATEGORY_NAME, exact: true }).click();
      await page.locator('textarea[name="description"]').fill('QA availability/offer test - safe to delete.');
      await page.locator('input[name="mainPrice"]').fill(PRODUCT_PRICE);
      await page.locator('input[name="minimumOrderAmount"]').fill('1');
      await page.locator('input[name="discount"]').fill('0');
      await page.locator('input#product-image').setInputFiles(TEST_IMAGE);
      await page.getByRole('button', { name: 'إضافة المنتج', exact: true }).click();
      await expect(page).toHaveURL(PRODUCTS_URL);
      await expect(page.getByRole('heading', { name: productName, exact: true })).toBeVisible();
    });

    await test.step('Create an active offer linked only to the QA product', async () => {
      await page.goto(OFFERS_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'إضافة عرض', exact: true }).click();

      await page.locator('#dialog-offer-name').fill(offerName);
      await page.locator('#dialog-offer-description').fill('QA availability/offer test - safe to delete.');
      await page.locator('#dialog-original-price').fill(OFFER_ORIGINAL_PRICE);
      await page.locator('#dialog-discount-amount').fill(OFFER_DISCOUNT_AMOUNT);

      const today = new Date();
      const inAWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      await page.locator('input[name="fromDate"]').fill(isoDate(today));
      await page.locator('input[name="fromTime"]').fill('00:00');
      await page.locator('input[name="untilDate"]').fill(isoDate(inAWeek));
      await page.locator('input[name="untilTime"]').fill('23:59');

      const productPickerTrigger = page.getByRole('button', { name: 'ابحث عن منتج لإضافته إلى العرض' });
      await productPickerTrigger.click();
      const productSearchInput = page.locator('input[placeholder="ابحث عن منتج لإضافته إلى العرض"]');
      await productSearchInput.fill(productName);
      const productOption = page.locator('label').filter({ hasText: productName });
      await expect(productOption).toBeVisible();
      await productOption.locator('input[type="checkbox"]').check();
      await productPickerTrigger.click();
      await expect(page.getByText('منتجات العرض (1 مختار)')).toBeVisible();

      await page.locator('#dialog-offer-images').setInputFiles(TEST_IMAGE);

      const [createResponse] = await Promise.all([
        page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/offers')),
        page.getByRole('button', { name: 'نشر العرض', exact: true }).click(),
      ]);
      const createBody = await createResponse.json();
      expect(createResponse.ok(), `Offer create HTTP status was ${createResponse.status()}`).toBeTruthy();
      expect(createBody.code, `Offer create failed: ${createBody.message}`).toBe(200);
    });

    await test.step('Verify the product-offer relationship and that the offer is active', async () => {
      await expect(page.getByRole('heading', { name: offerName, exact: true })).toBeVisible();
      const offerCard = page.locator('article[role="button"]', {
        has: page.getByRole('heading', { name: offerName, exact: true }),
      });
      await expect(offerCard.getByText('عرض نشط', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: `تعديل ${offerName}`, exact: true }).click();
      await expect(page.getByText('منتجات العرض (1 مختار)')).toBeVisible();
      await expect(page.getByText(productName, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
    });

    await test.step('Change the product availability to Unavailable', async () => {
      await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
      const availabilitySwitch = page.getByRole('switch', { name: `تعطيل ${productName}`, exact: true });
      await expect(availabilitySwitch).toHaveAttribute('aria-checked', 'true');

      const [toggleResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            ['PATCH', 'PUT', 'POST'].includes(res.request().method()) &&
            /\/api\/store\/v1\/products\/\d+/.test(res.url()),
        ),
        availabilitySwitch.click(),
      ]);
      const toggleBody = await toggleResponse.json();
      expect(toggleResponse.ok(), `Availability toggle HTTP status was ${toggleResponse.status()}`).toBeTruthy();
      expect(toggleBody.code, `Availability toggle failed: ${toggleBody.message}`).toBe(200);
    });

    await test.step('Verify the availability change persisted after reload', async () => {
      await page.reload({ waitUntil: 'networkidle' });
      const card = page.locator('article[role="button"]', {
        has: page.getByRole('heading', { name: productName, exact: true }),
      });
      await expect(card).toBeVisible();
      await expect(card.getByRole('switch', { name: `تفعيل ${productName}`, exact: true })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    await test.step('Verify the offer still exists and retains its original configuration', async () => {
      await page.goto(OFFERS_URL, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: offerName, exact: true })).toBeVisible();
      const offerCard = page.locator('article[role="button"]', {
        has: page.getByRole('heading', { name: offerName, exact: true }),
      });
      // Still reads as an active offer - STR-17 says product unavailability
      // must not auto-modify the offer.
      await expect(offerCard.getByText('عرض نشط', { exact: true })).toBeVisible();
      const discountedPrice = String(Number(OFFER_ORIGINAL_PRICE) - Number(OFFER_DISCOUNT_AMOUNT));
      await expect(offerCard.getByText(discountedPrice, { exact: true })).toBeVisible();
    });

    await test.step('Verify the correct product is still linked to the offer', async () => {
      await page.getByRole('button', { name: `تعديل ${offerName}`, exact: true }).click();
      await expect(page.getByText('منتجات العرض (1 مختار)')).toBeVisible();
      await expect(page.getByText(productName, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
    });

    await test.step('No unexpected console errors or failed requests occurred', async () => {
      expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
      expect(networkIssues, networkIssues.join('\n')).toEqual([]);
    });

    await test.step('Delete the QA offer and confirm removal', async () => {
      await deleteOfferIfPresent(page, offerName);
    });

    await test.step('Delete the QA product and confirm removal', async () => {
      await deleteProductIfPresent(page, productName);
    });
  });
});
