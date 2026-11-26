/**
 * Employee UI — branding images load before sign-in (FileStore regression, requirements §2.3).
 *
 * The FileStore fix requires a token for every FileStore call. Branding on the
 * login and landing pages is shown BEFORE anyone signs in, so it must not
 * depend on a token: those images must still load. Manual case SEC/011.
 *
 * Signed-out by construction (empty storageState); no wording or file names are
 * assumed — every visible image on the page must decode, with a positive
 * control that at least one is shown.
 */
import { test, expect } from '../utils/session-test';
import { BASE_URL } from '../utils/env';
import { signedOutImages } from '../utils/complaint-files-ui';

const TAGS = ['@2.12_session_checks', '@area:auth', '@kind:regression', '@layer:ui', '@persona:employee'];

test.describe('employee — branding before sign-in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('branding images on the login page load for a signed-out visitor @SEC/011', {
    annotation: {
      type: 'description',
      description: `SEC/011: FileStore now needs a token, but branding shown BEFORE sign-in must still load.

Steps:
1. Open /digit-ui/employee/user/login in a browser with no session.
2. Assert at least one image is visible (positive control: the page rendered its branding).
3. Assert every visible image decoded (naturalWidth > 0) and no image or FileStore response failed.`,
    },
    tag: TAGS,
  }, async ({ page }) => {
    const r = await signedOutImages(page, `${BASE_URL}/digit-ui/employee/user/login`);
    expect(r.visible, 'login page: no visible image — the page did not render its branding').toBeGreaterThan(0);
    expect(r.broken, 'login page: visible images that failed to load').toEqual([]);
    expect(r.failedResponses, 'login page: image / FileStore responses that failed before sign-in').toEqual([]);
  });
});
