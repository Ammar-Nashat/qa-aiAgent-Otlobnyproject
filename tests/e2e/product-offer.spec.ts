import { test, expect, type Page } from '@playwright/test';
import path from 'path';

const BASE_URL = 'https://designforge-ui.com';
const PRODUCTS_URL = `${BASE_URL}/Atlobni/ar/products`;
const OFFERS_URL = `${BASE_URL}/Atlobni/ar/offers`;
const AUTH_STATE = path.join(__dirname, '..', '..', 'auth.json');
const TEST_IMAGE = path.join(__dirname, '..', 'products', 'fixtures', 'qa-test-image.png');

const CATEGORY_NAME = 'امريكي';

const PRODUCT_PRICE = '100';
const PRODUCT_DISCOUNT = '10'; // product-level discount, independent of the offer
const OFFER_ORIGINAL_PRICE = '100';
const OFFER_DISCOUNT_AMOUNT = '30'; // deliberately different from the product-level discount
const OFFER_DISCOUNTED_PRICE = String(Number(OFFER_ORIGINAL_PRICE) - Number(OFFER_DISCOUNT_AMOUNT));

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

test.describe('Products -> Offers -> Products (cross-module, safe, self-cleaning)', () => {
  test.use({ storageState: AUTH_STATE });

  let productName: string;
  let offerName: string;

  test.beforeEach(() => {
    const ts = Date.now();
    productName = `QA Test Product ${ts}`;
    offerName = `QA Test Offer ${ts}`;
  });

  test.afterEach(async ({ page }) => {
    // Cleanup order per spec: offer first, then product, each verified server-side.
    // Wrapped so a failure here never masks the original test failure.
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

  test('Create product with discount, link an offer with an independent discount, verify cross-module behavior, clean up', async ({
    page,
  }) => {
    await test.step('Create a QA product with price and a product-level discount', async () => {
      await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'إضافة منتج', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'إضافة منتج', exact: true })).toBeVisible();

      await page.locator('input[name="name"]').fill(productName);
      await page.locator('#product-category').click();
      await page.getByRole('option', { name: CATEGORY_NAME, exact: true }).click();
      await page.locator('textarea[name="description"]').fill('QA cross-module product/offer test - safe to delete.');
      await page.locator('input[name="mainPrice"]').fill(PRODUCT_PRICE);
      await page.locator('input[name="minimumOrderAmount"]').fill('1');
      await page.locator('input[name="discount"]').fill(PRODUCT_DISCOUNT);
      await page.locator('input#product-image').setInputFiles(TEST_IMAGE);

      await page.getByRole('button', { name: 'إضافة المنتج', exact: true }).click();
      await expect(page).toHaveURL(PRODUCTS_URL);
    });

    await test.step('Verify the product was created successfully', async () => {
      await expect(page.getByRole('heading', { name: productName, exact: true })).toBeVisible();
    });

    await test.step('Create a QA offer linked only to the QA product, with an independent offer-level discount', async () => {
      await page.goto(OFFERS_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'إضافة عرض', exact: true }).click();

      await page.locator('#dialog-offer-name').fill(offerName);
      await page.locator('#dialog-offer-description').fill('QA cross-module offer - safe to delete.');
      await page.locator('#dialog-original-price').fill(OFFER_ORIGINAL_PRICE);
      await page.locator('#dialog-discount-amount').fill(OFFER_DISCOUNT_AMOUNT);

      const today = new Date();
      const inAWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      await page.locator('input[name="fromDate"]').fill(isoDate(today));
      await page.locator('input[name="fromTime"]').fill('09:00');
      await page.locator('input[name="untilDate"]').fill(isoDate(inAWeek));
      await page.locator('input[name="untilTime"]').fill('21:00');

      // Product picker is an inline checkbox dropdown with a live server-side
      // search (GET /products?search=...), not a role="option" listbox.
      const productPickerTrigger = page.getByRole('button', { name: 'ابحث عن منتج لإضافته إلى العرض' });
      await productPickerTrigger.click();
      const productSearchInput = page.locator('input[placeholder="ابحث عن منتج لإضافته إلى العرض"]');
      await productSearchInput.fill(productName);
      const productOption = page.locator('label').filter({ hasText: productName });
      await expect(productOption).toBeVisible();
      await productOption.locator('input[type="checkbox"]').check();
      await productPickerTrigger.click(); // collapse the dropdown

      await expect(page.getByText('منتجات العرض (1 مختار)')).toBeVisible();

      // Offer image is validated as required server-side ("مطلوب صورة واحدة
      // للعرض على الأقل") even though the UI shows no required-field asterisk
      // for it, mirroring the same optional-vs-required label bug already
      // found on the product logo field.
      await page.locator('#dialog-offer-images').setInputFiles(TEST_IMAGE);

      // This API returns HTTP 200 even on validation failures, with the real
      // outcome in a JSON `code` field (confirmed on the product endpoint
      // earlier: a 200 response carrying {"code":422,...}). So res.ok() alone
      // is not a reliable success check here - parse the body instead.
      const [createResponse] = await Promise.all([
        page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/offers')),
        page.getByRole('button', { name: 'نشر العرض', exact: true }).click(),
      ]);
      const createBody = await createResponse.json();
      expect(createResponse.ok(), `Offer create HTTP status was ${createResponse.status()}`).toBeTruthy();
      expect(createBody.code, `Offer create failed: ${createBody.message}`).toBe(200);
    });

    await test.step('Verify the offer was created successfully', async () => {
      await expect(page.getByRole('heading', { name: offerName, exact: true })).toBeVisible();
    });

    await test.step('Verify the offer is linked to exactly the QA product', async () => {
      await page.getByRole('button', { name: `تعديل ${offerName}`, exact: true }).click();
      await expect(page.getByText('منتجات العرض (1 مختار)')).toBeVisible();
      await expect(page.getByText(productName, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
    });

    await test.step('Verify the product appears under the Has Offer filter in Products', async () => {
      await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
      const availabilityTabs = page.getByRole('tablist', { name: 'تصفية المنتجات' });
      await availabilityTabs.getByRole('tab', { name: 'عليه عرض', exact: true }).click();
      await expect(page).toHaveURL(/hasOffer=1/);
      await expect(page.getByRole('heading', { name: productName, exact: true })).toBeVisible();
    });

    await test.step('Verify the regular product still shows its own price/discount, independent of the offer', async () => {
      await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
      const card = page.locator('article[role="button"]', {
        has: page.getByRole('heading', { name: productName, exact: true }),
      });
      await expect(card.getByText(PRODUCT_PRICE, { exact: true })).toBeVisible();

      await page.getByRole('button', { name: `تعديل ${productName}`, exact: true }).click();
      await expect(page.locator('input[name="discount"]')).toHaveValue(PRODUCT_DISCOUNT);
      await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
    });

    await test.step('Verify the offer displays its own independently configured discounted price', async () => {
      await page.goto(OFFERS_URL, { waitUntil: 'networkidle' });
      const offerCard = page.locator('article[role="button"]', {
        has: page.getByRole('heading', { name: offerName, exact: true }),
      });
      await expect(offerCard.getByText(OFFER_DISCOUNTED_PRICE, { exact: true })).toBeVisible();
    });

    await test.step('Delete the QA offer and confirm removal', async () => {
      await deleteOfferIfPresent(page, offerName);
    });

    await test.step('Delete the QA product and confirm removal', async () => {
      await deleteProductIfPresent(page, productName);
    });
  });
});
