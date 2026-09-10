import { test, expect } from '@playwright/test';

const appUrl = process.env.SOURCE_BANK_APP_URL;
test('actual local native bank and held-out ranking render without disrupting baseline', async ({ page, request }) => {
  test.setTimeout(120000);
  test.skip(!appUrl, 'Set SOURCE_BANK_APP_URL to a local app with retained native source-bank evidence.');
  const url = new URL(appUrl!);
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  const response = await request.get(new URL('/api/source/status', url).href);
  expect(response.ok()).toBe(true);
  let status = await response.json();
  await expect.poll(async () => {
    status = await (await request.get(new URL('/api/source/status', url).href)).json();
    return Boolean(status.fit.result && status.score.result);
  }, { timeout: 20000, intervals: [1000, 2000] }).toBe(true);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url.href);
  await page.getByRole('button', { name: 'Experiments', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Optional source and tract inference' });
  await expect(panel).toBeVisible();
  if (!status.forecast.result) {
    const before = { baseline: status.baselineModelId, source: status.sourceModelId, ranking: status.score.result.conditionalRanking.rankingId };
    await panel.getByLabel('Enable optional source experiments').check();
    await panel.getByRole('button', { name: 'Freeze optional prediction' }).click();
    await expect.poll(async () => {
      status = await (await request.get(new URL('/api/source/status', url).href)).json();
      return status.forecast.status;
    }, { timeout: 90000, intervals: [1000, 2000] }).toBe('succeeded');
    expect(status.baselineModelId).toBe(before.baseline);
    expect(status.sourceModelId).toBe(before.source);
    expect(status.score.result.conditionalRanking.rankingId).toBe(before.ranking);
    await panel.getByRole('button', { name: 'Refresh optional status' }).click();
  }
  const forecast = status.forecast.result.forecast;
  const score = status.score.result;
  expect(status.enabled).toBe(true);
  expect(forecast.kind).toBe('frozen-phonation-bank-1');
  expect(forecast.actual_synthesis_calls).toBeGreaterThan(0);
  expect(forecast.alternatives.length).toBeGreaterThan(1);
  expect(score.forecast_sha256).toBe(score.conditionalRanking.bankSha256);
  expect(score.model_updated).toBe(false);
  expect(score.conditionalRanking.rankingId).toBeTruthy();
  await panel.getByText(`Frozen competing predictions (${forecast.alternatives.length})`, { exact: true }).click();
  for (const row of forecast.alternatives) {
    await expect(panel).toContainText(`${row.family} / ${row.candidate_id}`);
    if (row.reason) await expect(panel).toContainText(row.reason);
  }
  await expect(panel).toContainText('Conditional ranking of the frozen alternatives follows');
  await expect(panel).toContainText(score.conditionalRanking.rankingId);
  for (const row of score.alternatives) {
    if (typeof row.score === 'number') await expect(panel).toContainText(row.score.toFixed(3));
    if (row.reason) await expect(panel).toContainText(row.reason);
  }
  await expect(panel).toContainText('No model update was applied; the baseline is retained');
  if (!status.forecast.current) await expect(panel.getByRole('button', { name: 'Score later capture against source prediction' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Scientific model', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  expect(errors).toEqual([]);
});
