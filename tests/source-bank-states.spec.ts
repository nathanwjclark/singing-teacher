import { test, expect } from '@playwright/test';

test('unavailable bank predictions and held-out ranks stay explicit (UI contract fixture)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const forecast = { kind: 'frozen-phonation-bank-1', target_id: 'bank-target', status: 'available', sealed_at: '2026-09-10T12:00:00Z',
    alternatives: [{ alternative_id: 'joint:one', family: 'joint', candidate_id: 'one', calibration_score: 2, status: 'unavailable', reason: 'Unsupported measurement window', record: null, controls: { PS: 0.2 }, anatomy: { palate: 3 }, source_model: 'geometric', requested_f0_hz: 190, simulated_f0_hz: null },
      { alternative_id: 'joint:two', family: 'joint', candidate_id: 'two', calibration_score: 1.5, status: 'available', reason: null, record: {}, controls: { source_model: 'two_mass', XB: 0.005, XT: 0.005, EAA: 0, DF: 1 }, anatomy: { palate: 3 }, source_model: 'two_mass', requested_f0_hz: 190, simulated_f0_hz: 201.3 }] };
  await page.route('**/api/source/status', route => route.fulfill({ json: { enabled: true, running: false, sessionId: 'fixture-session', runId: 'fixture-run',
    fit: { status: 'not-run' }, forecast: { status: 'succeeded', current: false, authoritativeStatus: 'scored', result: { forecast, sha256: 'fixture-bank' } },
    score: { status: 'succeeded', result: { status: 'inconclusive', alternatives: [{ ...forecast.alternatives[0], score: null, score_excluding_pitch: null, heldout_rank: null, calibration_rank: 2, rank_change: null },
      { ...forecast.alternatives[1], score: 0.42, score_excluding_pitch: 0.17, heldout_rank: 1, calibration_rank: 1, rank_change: 0 }], model_updated: false,
      conditionalRanking: { rankingId: 'fixture-ranking', version: 1, parentRankingId: null, bankSha256: 'fixture-bank' } } } } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Experiments', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Optional source and tract inference' });
  await panel.getByText('Frozen competing predictions (2)', { exact: true }).click();
  await expect(panel).toContainText('Unsupported measurement window');
  const [frozen, ranking] = [panel.getByRole('table').first(), panel.getByRole('table').last()];
  await expect(frozen.getByRole('row').nth(1)).toContainText('190.0 → Unavailable');
  await expect(frozen.getByRole('row').nth(2)).toContainText('190.0 → 201.3');
  await expect(frozen.getByRole('row').nth(2)).toContainText('joint / two · two_mass');
  await expect(ranking.getByRole('row').nth(1)).toContainText('Unavailable');
  await expect(ranking.getByRole('row').nth(2)).toContainText('0.420');
  await expect(ranking.getByRole('row').nth(2)).toContainText('0.170');
  await expect(ranking.getByRole('row').nth(2)).toContainText('190.0 → 201.3');
  await ranking.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/source-bank-states-f0.png' });
  await expect(panel).toContainText('fixture-ranking');
  await expect(panel).toContainText('No model update was applied; the baseline is retained');
  await expect(panel.getByRole('button', { name: 'Score later capture against source prediction' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
