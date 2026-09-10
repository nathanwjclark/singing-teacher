import { test, expect } from '@playwright/test';

test('unavailable bank predictions and held-out ranks stay explicit (UI contract fixture)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const forecast = { kind: 'frozen-phonation-bank-1', target_id: 'bank-target', status: 'available', sealed_at: '2026-09-10T12:00:00Z',
    alternatives: [{ alternative_id: 'joint:one', family: 'joint', candidate_id: 'one', calibration_score: 2, status: 'unavailable', reason: 'Unsupported measurement window', record: null, controls: { PS: 0.2 }, anatomy: { palate: 3 } }] };
  await page.route('**/api/source/status', route => route.fulfill({ json: { enabled: true, running: false, sessionId: 'fixture-session', runId: 'fixture-run',
    fit: { status: 'not-run' }, forecast: { status: 'succeeded', current: false, authoritativeStatus: 'scored', result: { forecast, sha256: 'fixture-bank' } },
    score: { status: 'succeeded', result: { status: 'inconclusive', alternatives: [{ ...forecast.alternatives[0], score: null, heldout_rank: null, calibration_rank: 1, rank_change: null }], model_updated: false,
      conditionalRanking: { rankingId: 'fixture-ranking', version: 1, parentRankingId: null, bankSha256: 'fixture-bank' } } } } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Experiments', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Optional source and tract inference' });
  await panel.getByText('Frozen competing predictions (1)', { exact: true }).click();
  await expect(panel).toContainText('Unsupported measurement window');
  await expect(panel.getByRole('table').last()).toContainText('Unavailable');
  await expect(panel).toContainText('fixture-ranking');
  await expect(panel).toContainText('No model update was applied; the baseline is retained');
  await expect(panel.getByRole('button', { name: 'Score later capture against source prediction' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
