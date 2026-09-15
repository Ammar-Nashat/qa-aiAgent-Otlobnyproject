import { test, expect } from '@playwright/test';
import path from 'path';

const BASE_URL = 'https://designforge-ui.com';
const PRODUCTS_URL = `${BASE_URL}/Atlobni/ar/products`;
const AUTH_STATE = path.join(__dirname, '..', '..', 'auth.json');

const PRODUCTS = {
  crepe: { name: 'كريب ستربس', category: 'امريكي', categoryId: '107', price: '25' },
  burger: { name: 'دوبل سماش برجر', category: 'امريكي' },
  falafel: { name: 'سندوتش طعمية', category: 'شعبي' }, // has an active offer
  foul: { name: 'سندوتش فول', category: 'شعبي' },
};

const NO_RESULTS_TEXT = 'لا توجد منتجات مطابقة';

test.describe('Products module', () => {
  test.use({ storageState: AUTH_STATE });

  test.beforeEach(async ({ page }) => {
    await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
  });

  test('1. Products page loads successfully', async ({ page }) => {
    await expect(page).toHaveTitle('Atlobni Merchant Dashboard');
    await expect(page.getByRole('heading', { name: 'المنتجات', exact: true })).toBeVisible();
  });

  test('2. Product grid renders known seeded products', async ({ page }) => {
    const cards = page.locator('article[role="button"]');
    await expect(cards).toHaveCount(4);
    for (const product of Object.values(PRODUCTS)) {
      await expect(page.getByRole('heading', { name: product.name, exact: true })).toBeVisible();
    }
  });

  test('3. Search with valid Arabic product name filters the grid', async ({ page }) => {
    await page.getByPlaceholder('ابحث عن منتج...').fill('كريب');
    await expect(page).toHaveURL(/search=/);
    await expect(page.getByRole('heading', { name: PRODUCTS.crepe.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: PRODUCTS.burger.name, exact: true })).toHaveCount(0);
  });

  test('4. Search with no matching result shows empty state', async ({ page }) => {
    await page.getByPlaceholder('ابحث عن منتج...').fill('zzzxxxqqq12345nonexistent');
    await expect(page).toHaveURL(/search=/);
    await expect(page.getByText(NO_RESULTS_TEXT)).toBeVisible();
  });

  test('5. Clearing search restores the full product list', async ({ page }) => {
    const search = page.getByPlaceholder('ابحث عن منتج...');
    await search.fill('كريب');
    await expect(page).toHaveURL(/search=/);
    await search.fill('');
    await expect(page.locator('article[role="button"]')).toHaveCount(4);
  });

  test('6. Category filters show the correct product subset', async ({ page }) => {
    const categoryTabs = page.getByRole('tablist', { name: 'تصنيفات المنتجات' });

    await categoryTabs.getByRole('tab', { name: 'امريكي', exact: true }).click();
    await expect(page).toHaveURL(/category=/);
    await expect(page.locator('article[role="button"]')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: PRODUCTS.crepe.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: PRODUCTS.burger.name, exact: true })).toBeVisible();

    await categoryTabs.getByRole('tab', { name: 'شعبي', exact: true }).click();
    await expect(page.locator('article[role="button"]')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: PRODUCTS.falafel.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: PRODUCTS.foul.name, exact: true })).toBeVisible();

    await categoryTabs.getByRole('tab', { name: 'الكل', exact: true }).click();
    await expect(page.locator('article[role="button"]')).toHaveCount(4);
  });

  test('7. Available products filter shows all seeded products', async ({ page }) => {
    const availabilityTabs = page.getByRole('tablist', { name: 'تصفية المنتجات' });
    await availabilityTabs.getByRole('tab', { name: 'متاح', exact: true }).click();
    await expect(page).toHaveURL(/status=1/);
    await expect(page.locator('article[role="button"]')).toHaveCount(4);
  });

  test('8. Unavailable products filter shows empty state', async ({ page }) => {
    const availabilityTabs = page.getByRole('tablist', { name: 'تصفية المنتجات' });
    await availabilityTabs.getByRole('tab', { name: 'غير متاح', exact: true }).click();
    await expect(page).toHaveURL(/status=0/);
    await expect(page.getByText(NO_RESULTS_TEXT)).toBeVisible();
  });

  test('9. Has-offer filter shows only the product with an active offer', async ({ page }) => {
    const availabilityTabs = page.getByRole('tablist', { name: 'تصفية المنتجات' });
    await availabilityTabs.getByRole('tab', { name: 'عليه عرض', exact: true }).click();
    await expect(page).toHaveURL(/hasOffer=1/);
    await expect(page.locator('article[role="button"]')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: PRODUCTS.falafel.name, exact: true })).toBeVisible();
  });

  test('10. Add Product form opens with the expected fields', async ({ page }) => {
    await page.getByRole('button', { name: 'إضافة منتج', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'إضافة منتج', exact: true })).toBeVisible();

    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('select[name="categoryId"]')).toBeVisible();
    await expect(page.locator('textarea[name="description"]')).toBeVisible();
    await expect(page.locator('input[type="file"]').first()).toBeAttached();
    await expect(page.locator('input[name="mainPrice"]')).toBeVisible();
    await expect(page.locator('input[name="minimumOrderAmount"]')).toBeVisible();
    await expect(page.locator('input[name="discount"]')).toBeVisible();

    // TODO: assert required-field (*) indicators once confirmed as an intended requirement.
    // TODO: assert "إضافة المنتج" submit button disabled state on empty form, once confirmed as intended behavior.

    // Close without submitting.
    await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
  });

  test('11. Edit Product page opens with existing data pre-filled', async ({ page }) => {
    await page.getByRole('button', { name: `تعديل ${PRODUCTS.crepe.name}`, exact: true }).click();

    await expect(page).toHaveURL(/\/products\/\d+\/edit/);
    await expect(page.getByRole('heading', { name: 'تعديل المنتج', exact: true })).toBeVisible();

    await expect(page.locator('input[name="name"]')).toHaveValue(PRODUCTS.crepe.name);
    await expect(page.locator('select[name="categoryId"]')).toHaveValue(PRODUCTS.crepe.categoryId);
    await expect(page.locator('input[name="mainPrice"]')).toHaveValue(PRODUCTS.crepe.price);

    // Close without saving.
    await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
  });
});

test.describe('Products module - navigation & reliability', () => {
  test.use({ storageState: AUTH_STATE });

  test('12. Browser Back returns safely to Products without saving', async ({ page }) => {
    await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: `تعديل ${PRODUCTS.crepe.name}`, exact: true }).click();
    await expect(page).toHaveURL(/\/products\/\d+\/edit/);

    await page.goBack({ waitUntil: 'networkidle' });

    await expect(page).toHaveURL(PRODUCTS_URL);
    await expect(page.getByRole('heading', { name: PRODUCTS.crepe.name, exact: true })).toBeVisible();
  });

  test('13. No console errors during normal Products navigation', async ({ page }) => {
    const consoleIssues: string[] = [];
    page.on('console', (msg) => {
      if (['error', 'warning'].includes(msg.type())) {
        consoleIssues.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
    await page.getByRole('tablist', { name: 'تصنيفات المنتجات' }).getByRole('tab', { name: 'امريكي', exact: true }).click();
    await page.getByRole('tablist', { name: 'تصفية المنتجات' }).getByRole('tab', { name: 'متاح', exact: true }).click();
    const search = page.getByPlaceholder('ابحث عن منتج...');
    await search.fill('كريب');
    await expect(page).toHaveURL(/search=/);
    await search.fill('');

    expect(consoleIssues, consoleIssues.join('\n')).toEqual([]);
  });

  test('14. No failed network requests or 4xx/5xx responses during safe scenarios', async ({ page }) => {
    const networkIssues: string[] = [];
    page.on('requestfailed', (req) => {
      networkIssues.push(`FAILED ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        networkIssues.push(`HTTP ${res.status()} ${res.url()}`);
      }
    });

    await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
    await page.getByRole('tablist', { name: 'تصنيفات المنتجات' }).getByRole('tab', { name: 'شعبي', exact: true }).click();
    await page.getByRole('tablist', { name: 'تصفية المنتجات' }).getByRole('tab', { name: 'عليه عرض', exact: true }).click();

    expect(networkIssues, networkIssues.join('\n')).toEqual([]);
  });
});
