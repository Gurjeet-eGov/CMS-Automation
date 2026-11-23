import { test, expect } from '@playwright/test';
import { citizenOtpLoginViaUI } from '../utils/citizen-login';
import { CITIZEN_DEFAULT_NAME, generateCitizenPhone } from '../utils/env';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe('Citizen registration through BFF phone possession', () => {
  test('fresh phone → OTP → default national-number name → citizen home', { tag: ['@area:auth', '@persona:citizen'] }, async ({ page }) => {
    const phone = generateCitizenPhone();
    await citizenOtpLoginViaUI(page, phone);
    expect(page.url()).not.toContain('/login');
    expect(page.url()).not.toMatch(/\/register(\/|$)/);
    expect(await page.evaluate(() => Boolean(sessionStorage.getItem('Citizen.token')))).toBe(true);
    const info = await page.evaluate(() => JSON.parse(sessionStorage.getItem('Citizen.user-info') || '{}'));
    // The default name: the phone number on older builds, a fixed name such as
    // "Citizen" on DIGIT 3.0 (CITIZEN_DEFAULT_NAME in the environment's config).
    expect(info.name).toBe(CITIZEN_DEFAULT_NAME || phone);
    expect(info.uuid).toBeTruthy();
    expect(await page.locator('body').innerText()).not.toContain('Something went wrong');
  });
});
