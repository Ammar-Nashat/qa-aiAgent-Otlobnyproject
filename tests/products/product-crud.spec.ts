import { test, expect, type Page } from '@playwright/test';
import path from 'path';

const BASE_URL = 'https://designforge-ui.com';
const PRODUCTS_URL = `${BASE_URL}/Atlobni/ar/products`;
const AUTH_STATE = path.join(__dirname, '..', '..', 'auth.json');
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'qa-test-image.png');

// Existing, valid seeded category (confirmed via the live "التصنيف" dropdown).
const CATEGORY_NAME = 'امريكي';

const INITIAL_PRICE = '20';
const UPDATED_PRICE = '35';

/**
 * Deletes the given product by name if a card for it is currently present.
 * Used both by the test itself and by afterEach cleanup, so a partial
 * failure never leaves the QA-created product behind.
 *
 * The UI removes the product card optimistically as soon as the confirm
 * button is clicked, before the DELETE request actually completes. Asserting
 * only on the card disappearing is not enough: if the test (or context) ends
 * right after that, the request can be cut off in flight and the product
 * survives server-side even though the UI, and the assertion, looked clean.
 * Waiting for the actual DELETE response closes that gap.
 */
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
  expect(deleteResponse.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
}

test.describe('Products module - CRUD (safe, self-cleaning)', () => {
  test.use({ storageState: AUTH_STATE });

  let initialName: string;
  let updatedName: string;
  let namesToCleanUp: string[];

  test.beforeEach(() => {
    // Unique per run so this test never collides with real seeded data.
    initialName = `QA Test Product ${Date.now()}`;
    updatedName = `${initialName} - Updated`;
    namesToCleanUp = [initialName, updatedName];
  });

  test.afterEach(async ({ page }) => {
    // Reliable cleanup: if the test failed partway through (before or after
    // the rename step), remove the product under whichever name it still has.
    // Only ever targets the QA-generated names above, never existing products.
    try {
      await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
      for (const name of namesToCleanUp) {
        await deleteProductIfPresent(page, name);
      }
    } catch {
      // Best-effort: never let cleanup mask the original test failure.
    }
  });

  test('Create, edit, and delete a QA test product end-to-end', async ({ page }) => {
    await test.step('Open Products page', async () => {
      await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'المنتجات', exact: true })).toBeVisible();
    });

    await test.step('Create a new test product', async () => {
      await page.getByRole('button', { name: 'إضافة منتج', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'إضافة منتج', exact: true })).toBeVisible();

      await page.locator('input[name="name"]').fill(initialName);

      await page.locator('#product-category').click();
      await page.getByRole('option', { name: CATEGORY_NAME, exact: true }).click();

      await page.locator('textarea[name="description"]').fill('QA automated test product - safe to delete.');
      await page.locator('input[name="mainPrice"]').fill(INITIAL_PRICE);
      await page.locator('input[name="minimumOrderAmount"]').fill('1');
      await page.locator('input[name="discount"]').fill('0');

      // Product image is mandatory on create (confirmed: submitting without
      // one returns a "صورة المنتج مطلوبة" validation error).
      await page.locator('input#product-image').setInputFiles(TEST_IMAGE);

      await page.getByRole('button', { name: 'إضافة المنتج', exact: true }).click();
      await expect(page).toHaveURL(PRODUCTS_URL);
    });

    await test.step('Verify the product appears in the product list', async () => {
      await expect(page.getByRole('heading', { name: initialName, exact: true })).toBeVisible();
    });

    await test.step('Edit only the test product: change name and price', async () => {
      await page.getByRole('button', { name: `تعديل ${initialName}`, exact: true }).click();
      await expect(page).toHaveURL(/\/products\/\d+\/edit/);
      await expect(page.locator('input[name="name"]')).toHaveValue(initialName);

      await page.locator('input[name="name"]').fill(updatedName);
      await page.locator('input[name="mainPrice"]').fill(UPDATED_PRICE);

      await page.getByRole('button', { name: 'حفظ التعديلات', exact: true }).click();
      await expect(page).toHaveURL(PRODUCTS_URL);
    });

    await test.step('Verify the edited values are reflected', async () => {
      const card = page.locator('article[role="button"]', {
        has: page.getByRole('heading', { name: updatedName, exact: true }),
      });
      await expect(card).toBeVisible();
      await expect(card.getByText(UPDATED_PRICE, { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: initialName, exact: true })).toHaveCount(0);
    });

    await test.step('Delete only the test product', async () => {
      await page.getByRole('button', { name: `حذف ${updatedName}`, exact: true }).click();
    });

    await test.step('Confirm deletion in the confirmation dialog', async () => {
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(updatedName);

      // The card is removed from the UI optimistically on click, before the
      // DELETE request resolves. Wait for the actual response so the test
      // never finishes (and closes the page) while the deletion is still
      // in flight on the server.
      const [deleteResponse] = await Promise.all([
        page.waitForResponse(
          (res) => res.request().method() === 'DELETE' && /\/api\/store\/v1\/products\/\d+$/.test(res.url()),
        ),
        dialog.getByRole('button', { name: 'تأكيد الحذف', exact: true }).click(),
      ]);
      expect(deleteResponse.ok()).toBeTruthy();
    });

    await test.step('Verify the product no longer appears', async () => {
      await expect(page.getByRole('heading', { name: updatedName, exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: initialName, exact: true })).toHaveCount(0);
    });
  });
});
