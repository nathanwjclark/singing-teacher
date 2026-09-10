import { readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sha256 } from '../src/contracts/index.ts'
import { auditEvidence, readableReport } from '../src/reproducibility/index.ts'

export async function replayExperiment(manifestPath: string) {
  const root = await realpath(dirname(resolve(manifestPath)))
  const report = await auditEvidence(JSON.parse(await readFile(manifestPath, 'utf8')))
  for (const artifact of report.artifacts) {
    const uri = artifact.uri
    if (/^[a-z][a-z\d+.-]*:/i.test(uri)) {
      report.missing.push(`External media ${artifact.id} (${uri.split(':')[0]} URI) unavailable to local replay`)
      continue
    }
    if (isAbsolute(uri) || uri.split(/[\\/]/).includes('..') || uri.includes('\\') || uri.includes('\0')) { report.errors.push(`Unsafe artifact path: ${uri}`); continue }
    try {
      const path = await realpath(resolve(root, uri))
      const inside = relative(root, path)
      if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) { report.errors.push(`Artifact escapes manifest directory: ${uri}`); continue }
      const bytes = await readFile(path)
      if (bytes.byteLength !== artifact.byteLength) report.errors.push(`Artifact length mismatch: ${uri}`)
      if (await sha256(bytes) !== artifact.sha256) report.errors.push(`Artifact SHA-256 mismatch: ${uri}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') report.missing.push(`Missing external media file: ${uri}`)
      else report.errors.push(`Cannot read artifact ${uri}: ${String(error)}`)
    }
  }
  report.status = report.errors.length ? 'invalid' : report.missing.length ? 'incomplete' : 'valid-metadata'
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , input, output = 'evidence-report'] = process.argv
  if (!input) { console.error('Usage: node --experimental-strip-types scripts/replay-experiment.ts evidence.json [report-prefix]'); process.exitCode = 1 }
  else {
    try {
      const report = await replayExperiment(input)
      await writeFile(`${output}.json`, JSON.stringify(report, null, 2))
      await writeFile(`${output}.md`, readableReport(report))
      console.log(readableReport(report))
      process.exitCode = report.status === 'invalid' ? 1 : report.status === 'incomplete' ? 2 : 0
    } catch (error) { console.error(String(error)); process.exitCode = 1 }
  }
}
