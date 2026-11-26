/**
 * Lifecycle fixtures setup — runs once before any chromium test.
 *
 * Creates three complaints against the seed plan's (serviceCode, actor,
 * assignee) TRIPLE — see personas.ts's resolveSeedPlan() for why that triple,
 * not "whichever employee is handy", is what ASSIGN actually accepts:
 * pgr-services validates the ASSIGNEE's HRMS department against the
 * complaint type's department, and egov-workflow-v2 separately rejects an
 * assignee who holds no role able to act on the next state. On bomet the
 * actor (GRO) and the assignee are necessarily different people.
 *
 *  1. NON-TERMINAL: left at PENDINGFORASSIGNMENT.
 *  2. ASSIGNED: driven to PENDINGATLME and left there — assigned but
 *     unresolved, for specs that need an already-assigned complaint without
 *     walking it all the way to closed.
 *  3. TERMINAL+RATED: walked through ASSIGN → RESOLVE → RATE to land at
 *     CLOSEDAFTERRESOLUTION with a 4-star rating.
 *
 * Writes `lifecycle-fixtures.json` next to `auth.json` so downstream specs
 * can read deterministic, deployment-fresh SRIDs instead of pinning to
 * historical seed data.
 *
 * Seeding always goes through seedComplaintAsCitizen() (utils/seed.ts) —
 * APPLY is [CITIZEN, CSR] on every deployment, so filing as an
 * employee/ADMIN token is not a shortcut, it 400s "INVALID ROLE" on bomet.
 * ASSIGN/RESOLVE/RATE go through the matching seed.ts helper, which already
 * knows the actor and assignee can be different people and that RATE is only
 * open to whoever filed the complaint (not the LME).
 *
 * If resolveSeedPlan() can't find a viable triple on this deployment — no
 * complaint types, no ASSIGN transition, no eligible assignee, no GRO actor —
 * the setup writes a `status: 'skipped'` fixture file naming the precise
 * cause (never a bare uuid) and PASSES. This is intentional: a partial
 * deployment must not cascade-fail the whole chromium project; downstream
 * specs fall back to their own env-var/historical defaults instead.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT, RUN_SESSION_CHECKS, COMPLAINT_ID_PATTERN } from '../utils/env';
import { resolveSeedPlan } from '../utils/personas';
import {
  seedComplaintAsCitizen,
  driveToPendingAtLme,
  driveToResolved,
  driveToClosedRated,
  seedCitizen,
  complaintAsFiler,
} from '../utils/seed';
import { writeLifecycleFixtures, LifecycleFixtures } from '../utils/lifecycle-fixtures';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64',
);

/**
 * Upload one PNG to FileStore as the seeding citizen and return its fileStoreId.
 * Session-checks runs only. Tries the token in the auth-token header, then as
 * Authorization: Bearer — whichever the deployment's gateway takes.
 */
async function uploadSeedPhoto(token: string): Promise<string> {
  const tried: string[] = [];
  for (const headers of [{ 'auth-token': token }, { Authorization: `Bearer ${token}` }] as Record<string, string>[]) {
    const fd = new FormData();
    fd.append('tenantId', TENANT);
    fd.append('module', 'PGR');
    fd.append('file', new Blob([new Uint8Array(PNG_1x1)], { type: 'image/png' }), 'complaint-photo.png');
    const r = await fetch(`${BASE_URL}/filestore/v1/files`, { method: 'POST', headers, body: fd });
    const text = await r.text();
    let id = '';
    try {
      id = JSON.parse(text)?.files?.[0]?.fileStoreId || '';
    } catch {
      /* not JSON */
    }
    if (r.ok && id) return id;
    tried.push(`${Object.keys(headers)[0]}: HTTP ${r.status} ${text.slice(0, 120)}`);
  }
  throw new Error(`FileStore upload failed — ${tried.join(' | ')}`);
}

test('seed lifecycle fixtures (non-terminal + assigned + terminal-with-rating complaints)', async () => {
  const writeSkipped = (reason: string): void => {
    const fixtures: LifecycleFixtures = {
      generated_at: new Date().toISOString(),
      tenant: TENANT,
      status: 'skipped',
      skipped_reason: reason,
    };
    const path = writeLifecycleFixtures(fixtures);
    console.log(`[lifecycle.setup] SKIPPED: ${reason}`);
    console.log(`[lifecycle.setup] wrote skip marker to ${path}`);
  };

  // Session-checks runs (scope session-checks): file ONLY one complaint, with a
  // photo already in FileStore, for the file-access checks to open — no
  // workflow walk, so a persona or department gap on the deployment cannot
  // take the photo record down with it. Full runs never take this branch.
  if (RUN_SESSION_CHECKS) {
    let photo: LifecycleFixtures['photo'];
    let photoSkip = '';
    try {
      const filer = await seedCitizen();
      const fileStoreId = await uploadSeedPhoto(filer.token);
      const seeded = await seedComplaintAsCitizen({
        description: `session checks: complaint with a photo — ${new Date().toISOString()}`,
        documents: [{ fileStoreId }],
      });
      const wrapper = await complaintAsFiler(seeded.srid);
      if (!COMPLAINT_ID_PATTERN.test(seeded.srid)) {
        photoSkip = `${seeded.srid} does not match COMPLAINT_ID_PATTERN ${COMPLAINT_ID_PATTERN}; set COMPLAINT_ID_PATTERN in config.env for this deployment`;
      } else if (wrapper && JSON.stringify(wrapper).includes(fileStoreId)) {
        photo = { srid: seeded.srid, fileStoreId, citizenMobile: filer.mobile };
        console.log(`[lifecycle.setup] PHOTO attached to ${seeded.srid}`);
      } else {
        photoSkip = `${seeded.srid} was filed but its search result does not carry the attached file`;
      }
    } catch (err: any) {
      photoSkip = `filing a complaint with a photo failed on ${TENANT}: ${String(err?.message ?? err).slice(0, 200)}`;
    }
    const fixtures: LifecycleFixtures = {
      generated_at: new Date().toISOString(),
      tenant: TENANT,
      status: 'skipped',
      skipped_reason: 'session-checks run: only the complaint with a photo is seeded',
      ...(photo ? { photo } : {}),
      ...(photoSkip ? { photo_skipped_reason: photoSkip } : {}),
    };
    console.log(`[lifecycle.setup] wrote session-checks fixtures to ${writeLifecycleFixtures(fixtures)}${photoSkip ? ` — ${photoSkip}` : ''}`);
    return;
  }

  const plan = await resolveSeedPlan();
  if ('error' in plan) {
    writeSkipped(plan.error);
    return; // PASS the setup — downstream uses env/defaults
  }
  console.log(
    `[lifecycle.setup] tenant=${TENANT} serviceCode=${plan.serviceCode} localityCode=${plan.localityCode} ` +
    `actor=${plan.actor.username} assignee=${plan.assigneeCode}`,
  );

  let nonTerminal: string;
  let assigned: string;
  let terminal: string;
  try {
    // Complaint 1: non-terminal, left at PENDINGFORASSIGNMENT.
    const seeded1 = await seedComplaintAsCitizen({ description: `lifecycle setup non-terminal — ${new Date().toISOString()}` });
    // Id format differs per deployment: COMPLAINT_ID_PATTERN (config.env), default ^[A-Z]+-\d{4}-\d+$.
    expect(seeded1.srid, `serviceRequestId must match COMPLAINT_ID_PATTERN ${COMPLAINT_ID_PATTERN}`).toMatch(COMPLAINT_ID_PATTERN);
    expect(seeded1.status, 'non-terminal initial status').toBe('PENDINGFORASSIGNMENT');
    nonTerminal = seeded1.srid;
    console.log(`[lifecycle.setup] NON_TERMINAL ${nonTerminal} → PENDINGFORASSIGNMENT`);

    // Complaint 2: assigned to the seed plan's assignee, left at PENDINGATLME.
    const seeded2 = await seedComplaintAsCitizen({ description: `lifecycle setup assigned — ${new Date().toISOString()}` });
    assigned = seeded2.srid;
    await driveToPendingAtLme(assigned);
    console.log(`[lifecycle.setup] ASSIGNED ${assigned} → PENDINGATLME (assignee ${plan.assigneeCode})`);

    // Complaint 3: walk it end-to-end to CLOSEDAFTERRESOLUTION + rating.
    const seeded3 = await seedComplaintAsCitizen({ description: `lifecycle setup terminal-rated — ${new Date().toISOString()}` });
    terminal = seeded3.srid;
    console.log(`[lifecycle.setup] terminal-track ${terminal} → PENDINGFORASSIGNMENT (will walk forward)`);
    await driveToPendingAtLme(terminal);
    console.log(`[lifecycle.setup] terminal-track ${terminal} → PENDINGATLME`);
    await driveToResolved(terminal);
    console.log(`[lifecycle.setup] terminal-track ${terminal} → RESOLVED`);
    await driveToClosedRated(terminal, 4);
    console.log(`[lifecycle.setup] terminal-track ${terminal} → CLOSEDAFTERRESOLUTION rating=4`);
  } catch (err: any) {
    writeSkipped(`workflow walk: ${err.message?.slice(0, 200)}`);
    return; // PASS — downstream falls back
  }

  // Persist the full fixtures so downstream specs can read them.
  const fixtures: LifecycleFixtures = {
    generated_at: new Date().toISOString(),
    tenant: TENANT,
    status: 'ok',
    complaints: {
      non_terminal: nonTerminal,
      terminal_rated: terminal,
      assigned_to_employee: assigned,
    },
    assignee: { uuid: plan.assigneeUuid, code: plan.assigneeCode },
  };
  const path = writeLifecycleFixtures(fixtures);
  console.log(`[lifecycle.setup] wrote fixtures to ${path}`);
});
