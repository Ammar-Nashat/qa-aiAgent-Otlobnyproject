import { expect, type Page } from '@playwright/test';
import path from 'path';

const BASE_URL = 'https://designforge-ui.com';
export const PRODUCTS_URL = `${BASE_URL}/Atlobni/ar/products`;
export const OFFERS_URL = `${BASE_URL}/Atlobni/ar/offers`;
export const TEST_IMAGE = path.join(__dirname, 'fixtures', 'qa-test-image.png');

export const CATEGORY_IDS: Record<string, string> = {
  امريكي: '107',
  شعبي: '106',
};

export interface QaProductSpec {
  name: string;
  categoryName: string;
  price: string;
  description?: string;
  discount?: string;
  minimumOrderAmount?: string;
}

/**
 * Create a QA-owned product via the same Add Product form flow used
 * throughout the suite. Waits for the redirect back to the product list and
 * confirms the new card is visible before returning.
 */
export async function createProduct(page: Page, spec: QaProductSpec): Promise<void> {
  await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'إضافة منتج', exact: true }).click();
  await page.locator('input[name="name"]').fill(spec.name);
  await page.locator('#product-category').click();
  await page.getByRole('option', { name: spec.categoryName, exact: true }).click();
  await page
    .locator('textarea[name="description"]')
    .fill(spec.description ?? 'QA regression fixture - safe to delete.');
  await page.locator('input[name="mainPrice"]').fill(spec.price);
  await page.locator('input[name="minimumOrderAmount"]').fill(spec.minimumOrderAmount ?? '1');
  await page.locator('input[name="discount"]').fill(spec.discount ?? '0');
  await page.locator('input#product-image').setInputFiles(TEST_IMAGE);
  await page.getByRole('button', { name: 'إضافة المنتج', exact: true }).click();
  await expect(page).toHaveURL(PRODUCTS_URL);
  await expect(page.getByRole('heading', { name: spec.name, exact: true })).toBeVisible();
}

/**
 * Deletes the product if a card for it is present, verifying the DELETE
 * response body's `code` field (not just HTTP status - this API returns
 * HTTP 200 even on failures) and that the heading disappears. Returns true
 * only when the product is confirmed gone (or was never there).
 */
export async function deleteProductIfPresent(page: Page, name: string): Promise<boolean> {
  await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
  const deleteButton = page.getByRole('button', { name: `حذف ${name}`, exact: true });
  if ((await deleteButton.count()) === 0) return true;

  await deleteButton.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();

  const [deleteResponse] = await Promise.all([
    page.waitForResponse(
      (res) => res.request().method() === 'DELETE' && /\/api\/store\/v1\/products\/\d+$/.test(res.url()),
    ),
    dialog.getByRole('button', { name: 'تأكيد الحذف', exact: true }).click(),
  ]);
  const body = await deleteResponse.json();
  const ok = deleteResponse.ok() && body.code === 200;
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  return ok;
}

/**
 * Toggles a product's availability via the quick-toggle switch on the list
 * card (STR-18). `available: false` clicks the "تعطيل" (disable) switch;
 * `available: true` clicks the "تفعيل" (enable) switch.
 */
export async function setProductAvailability(page: Page, name: string, available: boolean): Promise<void> {
  await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
  const switchName = available ? `تفعيل ${name}` : `تعطيل ${name}`;
  const toggle = page.getByRole('switch', { name: switchName, exact: true });

  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => ['PATCH', 'PUT', 'POST'].includes(r.request().method()) && /\/api\/store\/v1\/products\/\d+/.test(r.url()),
    ),
    toggle.click(),
  ]);
  const body = await res.json();
  expect(body.code, `Availability toggle failed: ${body.message}`).toBe(200);
}

export interface QaOfferSpec {
  name: string;
  description?: string;
  originalPrice: string;
  discountAmount: string;
  productNames: string[];
}

/**
 * Create a QA-owned offer linked to one or more already-created QA products,
 * via the same Add Offer flow used elsewhere in the suite. Offer images are
 * mandatory server-side despite no required-field asterisk in the UI, so an
 * image is always attached.
 */
export async function createOffer(page: Page, spec: QaOfferSpec): Promise<void> {
  await page.goto(OFFERS_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'إضافة عرض', exact: true }).click();

  await page.locator('#dialog-offer-name').fill(spec.name);
  await page.locator('#dialog-offer-description').fill(spec.description ?? 'QA regression fixture offer - safe to delete.');
  await page.locator('#dialog-original-price').fill(spec.originalPrice);
  await page.locator('#dialog-discount-amount').fill(spec.discountAmount);

  const today = new Date();
  const inAWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  await page.locator('input[name="fromDate"]').fill(today.toISOString().slice(0, 10));
  await page.locator('input[name="fromTime"]').fill('00:00');
  await page.locator('input[name="untilDate"]').fill(inAWeek.toISOString().slice(0, 10));
  await page.locator('input[name="untilTime"]').fill('23:59');

  const trigger = page.getByRole('button', { name: 'ابحث عن منتج لإضافته إلى العرض' });
  const searchInput = page.locator('input[placeholder="ابحث عن منتج لإضافته إلى العرض"]');
  for (const productName of spec.productNames) {
    await trigger.click();
    await searchInput.fill(productName);
    const option = page.locator('label').filter({ hasText: productName });
    await expect(option).toBeVisible();
    await option.locator('input[type="checkbox"]').check();
    await trigger.click();
  }
  await expect(page.getByText(`منتجات العرض (${spec.productNames.length} مختار)`)).toBeVisible();

  await page.locator('#dialog-offer-images').setInputFiles(TEST_IMAGE);

  const [createResponse] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/offers')),
    page.getByRole('button', { name: 'نشر العرض', exact: true }).click(),
  ]);
  const body = await createResponse.json();
  expect(body.code, `Offer create failed: ${body.message}`).toBe(200);
  await expect(page.getByRole('heading', { name: spec.name, exact: true })).toBeVisible();
}

/**
 * Deletes the offer if present, verifying the DELETE response body's `code`
 * field and that the heading disappears. Returns true only when the offer
 * is confirmed gone (or was never there).
 */
export async function deleteOfferIfPresent(page: Page, name: string): Promise<boolean> {
  await page.goto(OFFERS_URL, { waitUntil: 'networkidle' });
  const deleteButton = page.getByRole('button', { name: `حذف ${name}`, exact: true });
  if ((await deleteButton.count()) === 0) return true;

  await deleteButton.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();

  const [deleteResponse] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'DELETE' && res.url().includes('/offers/')),
    dialog.getByRole('button', { name: 'تأكيد الحذف', exact: true }).click(),
  ]);
  const body = await deleteResponse.json();
  const ok = deleteResponse.ok() && body.code === 200;
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  return ok;
}
