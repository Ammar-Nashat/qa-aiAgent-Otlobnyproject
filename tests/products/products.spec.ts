import { test, expect } from '@playwright/test';
import path from 'path';
import {
  createProduct,
  deleteProductIfPresent,
  setProductAvailability,
  createOffer,
  deleteOfferIfPresent,
  PRODUCTS_URL,
  CATEGORY_IDS,
} from './fixtures';

const AUTH_STATE = path.join(__dirname, '..', '..', 'auth.json');
const NO_RESULTS_TEXT = 'لا توجد منتجات مطابقة';

// This whole file shares one set of QA-owned fixture products/offer created
// once in beforeAll and torn down in afterAll, so tests must run in order
// rather than fullyParallel (the project default).
test.describe.configure({ mode: 'serial' });

const ts = Date.now();
const QA = {
  availableA: { name: `QA Fixture Available A ${ts}`, categoryName: 'امريكي', price: '30' },
  availableB: { name: `QA Fixture Available B ${ts}`, categoryName: 'شعبي', price: '40' },
  unavailable: { name: `QA Fixture Unavailable ${ts}`, categoryName: 'امريكي', price: '20' },
  withOffer: { name: `QA Fixture Offer Target ${ts}`, categoryName: 'شعبي', price: '50' },
};
const OFFER_NAME = `QA Fixture Promo ${ts}`;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: AUTH_STATE });
  const page = await context.newPage();

  await createProduct(page, QA.availableA);
  await createProduct(page, QA.availableB);
  await createProduct(page, QA.unavailable);
  await createProduct(page, QA.withOffer);

  await setProductAvailability(page, QA.unavailable.name, false);

  await createOffer(page, {
    name: OFFER_NAME,
    originalPrice: QA.withOffer.price,
    discountAmount: '10',
    productNames: [QA.withOffer.name],
  });

  await context.close();
});

test.afterAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: AUTH_STATE });
  const page = await context.newPage();

  const remaining: string[] = [];

  if (!(await deleteOfferIfPresent(page, OFFER_NAME))) {
    remaining.push(`offer "${OFFER_NAME}"`);
  }
  for (const p of Object.values(QA)) {
    if (!(await deleteProductIfPresent(page, p.name))) {
      remaining.push(`product "${p.name}"`);
    }
  }

  await context.close();

  if (remaining.length > 0) {
    throw new Error(`Fixture cleanup incomplete - QA records still present: ${remaining.join(', ')}`);
  }
});

test.describe('Products module', () => {
  test.use({ storageState: AUTH_STATE });

  test.beforeEach(async ({ page }) => {
    await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
  });

  test('1. Products page loads successfully', async ({ page }) => {
    await expect(page).toHaveTitle('Atlobni Merchant Dashboard');
    await expect(page.getByRole('heading', { name: 'المنتجات', exact: true })).toBeVisible();
  });

  test('2. Product grid renders known QA fixture products', async ({ page }) => {
    for (const p of Object.values(QA)) {
      await expect(page.getByRole('heading', { name: p.name, exact: true })).toBeVisible();
    }
  });

  test('3. Search with valid Arabic product name filters the grid', async ({ page }) => {
    await page.getByPlaceholder('ابحث عن منتج...').fill(QA.availableA.name);
    await expect(page).toHaveURL(/search=/);
    await expect(page.getByRole('heading', { name: QA.availableA.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: QA.availableB.name, exact: true })).toHaveCount(0);
  });

  test('4. Search with no matching result shows empty state', async ({ page }) => {
    await page.getByPlaceholder('ابحث عن منتج...').fill('zzzxxxqqq12345nonexistent');
    await expect(page).toHaveURL(/search=/);
    await expect(page.getByText(NO_RESULTS_TEXT)).toBeVisible();
  });

  test('5. Clearing search restores the full product list', async ({ page }) => {
    const search = page.getByPlaceholder('ابحث عن منتج...');
    await search.fill(QA.availableA.name);
    await expect(page).toHaveURL(/search=/);
    await expect(page.getByRole('heading', { name: QA.availableB.name, exact: true })).toHaveCount(0);

    await search.fill('');
    for (const p of Object.values(QA)) {
      await expect(page.getByRole('heading', { name: p.name, exact: true })).toBeVisible();
    }
  });

  test('6. Category filters show the correct product subset', async ({ page }) => {
    const categoryTabs = page.getByRole('tablist', { name: 'تصنيفات المنتجات' });

    await categoryTabs.getByRole('tab', { name: 'امريكي', exact: true }).click();
    await expect(page).toHaveURL(/category=/);
    await expect(page.getByRole('heading', { name: QA.availableA.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: QA.unavailable.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: QA.availableB.name, exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: QA.withOffer.name, exact: true })).toHaveCount(0);

    await categoryTabs.getByRole('tab', { name: 'شعبي', exact: true }).click();
    await expect(page.getByRole('heading', { name: QA.availableB.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: QA.withOffer.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: QA.availableA.name, exact: true })).toHaveCount(0);

    await categoryTabs.getByRole('tab', { name: 'الكل', exact: true }).click();
    for (const p of Object.values(QA)) {
      await expect(page.getByRole('heading', { name: p.name, exact: true })).toBeVisible();
    }
  });

  test('7. Available products filter includes available QA fixtures', async ({ page }) => {
    const availabilityTabs = page.getByRole('tablist', { name: 'تصفية المنتجات' });
    await availabilityTabs.getByRole('tab', { name: 'متاح', exact: true }).click();
    await expect(page).toHaveURL(/status=1/);
    await expect(page.getByRole('heading', { name: QA.availableA.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: QA.availableB.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: QA.withOffer.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: QA.unavailable.name, exact: true })).toHaveCount(0);
  });

  test('8. Unavailable products filter shows the QA unavailable fixture', async ({ page }) => {
    // Does not assume the merchant has zero unavailable products of its own -
    // asserts on a specific QA fixture we know is unavailable instead of
    // asserting the whole result set is empty.
    const availabilityTabs = page.getByRole('tablist', { name: 'تصفية المنتجات' });
    await availabilityTabs.getByRole('tab', { name: 'غير متاح', exact: true }).click();
    await expect(page).toHaveURL(/status=0/);
    await expect(page.getByRole('heading', { name: QA.unavailable.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: QA.availableA.name, exact: true })).toHaveCount(0);
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

    // Close without submitting.
    await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
  });

  test('11. Edit Product page opens with existing data pre-filled', async ({ page }) => {
    await page.getByRole('button', { name: `تعديل ${QA.availableA.name}`, exact: true }).click();

    await expect(page).toHaveURL(/\/products\/\d+\/edit/);
    await expect(page.getByRole('heading', { name: 'تعديل المنتج', exact: true })).toBeVisible();

    await expect(page.locator('input[name="name"]')).toHaveValue(QA.availableA.name);
    await expect(page.locator('select[name="categoryId"]')).toHaveValue(CATEGORY_IDS[QA.availableA.categoryName]);
    await expect(page.locator('input[name="mainPrice"]')).toHaveValue(QA.availableA.price);

    // Close without saving.
    await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
  });
});

test.describe('Products module - navigation & reliability', () => {
  test.use({ storageState: AUTH_STATE });

  test('12. Browser Back returns safely to Products without saving', async ({ page }) => {
    await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: `تعديل ${QA.availableA.name}`, exact: true }).click();
    await expect(page).toHaveURL(/\/products\/\d+\/edit/);

    await page.goBack({ waitUntil: 'networkidle' });

    await expect(page).toHaveURL(PRODUCTS_URL);
    await expect(page.getByRole('heading', { name: QA.availableA.name, exact: true })).toBeVisible();
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
    await search.fill(QA.availableA.name);
    await expect(page).toHaveURL(/search=/);
    await expect(page.getByRole('heading', { name: QA.availableA.name, exact: true })).toBeVisible();
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

  // Declared last in the whole file (still labeled "9" for traceability with
  // the original suite) so that a failure here - see the confirmed bug this
  // test currently surfaces - does not skip the independent tests above it
  // under serial mode.
  test('9. Has-offer filter shows the QA product linked to the QA offer', async ({ page }) => {
    await page.goto(PRODUCTS_URL, { waitUntil: 'networkidle' });
    const availabilityTabs = page.getByRole('tablist', { name: 'تصفية المنتجات' });
    await availabilityTabs.getByRole('tab', { name: 'عليه عرض', exact: true }).click();
    await expect(page).toHaveURL(/hasOffer=1/);
    await expect(page.getByRole('heading', { name: QA.withOffer.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: QA.availableA.name, exact: true })).toHaveCount(0);
  });
});
