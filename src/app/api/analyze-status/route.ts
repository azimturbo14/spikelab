import { NextRequest, NextResponse } from 'next/server'
import { readFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { getJob, completeJob, failJob } from '@/lib/analysis-jobs'

export const dynamic = 'force-dynamic'

const RESULTS_DIR = '/tmp/spikelab-results'

/**
 * GET: Poll analysis job status.
 * Query: ?jobId=xxx
 * Returns: { status, step, message, percent, analysis?, error? }
 *
 * Also checks for result files from detached analysis processes
 * (handles the case where the Node.js server restarted during analysis).
 */
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId')

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 })
  }

  const job = getJob(jobId)

  if (!job) {
    // Job might be from a previous server instance — check result files
    const resultFile = path.join(RESULTS_DIR, `${jobId}.json`)
    const errorFile = path.join(RESULTS_DIR, `${jobId}.error`)
    const lockFile = path.join(RESULTS_DIR, `${jobId}.lock`)

    if (existsSync(resultFile)) {
      try {
        const data = await readFile(resultFile, 'utf-8')
        const analysis = JSON.parse(data)
        // Clean up files
        await unlink(resultFile).catch(() => {})
        await unlink(lockFile).catch(() => {})
        await unlink(errorFile).catch(() => {})
        return NextResponse.json({
          status: 'done',
          step: 'done',
          message: 'Analysis complete!',
          percent: 100,
          analysis,
        })
      } catch {
        return NextResponse.json({ error: 'Failed to read analysis result' }, { status: 500 })
      }
    }

    if (existsSync(errorFile)) {
      try {
        const errorMsg = await readFile(errorFile, 'utf-8')
        await unlink(errorFile).catch(() => {})
        await unlink(lockFile).catch(() => {})
        return NextResponse.json({
          status: 'error',
          step: 'error',
          message: errorMsg,
          percent: 0,
          error: errorMsg,
        })
      } catch {
        return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
      }
    }

    if (existsSync(lockFile)) {
      // Analysis is still running in a detached process
      return NextResponse.json({
        status: 'processing',
        step: 'analyzing',
        message: 'Analysis in progress...',
        percent: 50,
      })
    }

    return NextResponse.json({ error: 'Job not found or expired' }, { status: 404 })
  }

  // Job exists in memory — check if we need to recover from result files
  if (job.status === 'processing') {
    const resultFile = path.join(RESULTS_DIR, `${jobId}.json`)
    const errorFile = path.join(RESULTS_DIR, `${jobId}.error`)

    if (existsSync(resultFile)) {
      try {
        const data = await readFile(resultFile, 'utf-8')
        const analysis = JSON.parse(data)
        completeJob(jobId, analysis)
        // Clean up
        await unlink(resultFile).catch(() => {})
        await unlink(errorFile).catch(() => {})
        const lockFile = path.join(RESULTS_DIR, `${jobId}.lock`)
        await unlink(lockFile).catch(() => {})
        return NextResponse.json({
          status: 'done',
          step: 'done',
          message: 'Analysis complete!',
          percent: 100,
          analysis,
        })
      } catch {
        // File exists but can't be read — keep waiting
      }
    }

    if (existsSync(errorFile)) {
      try {
        const errorMsg = await readFile(errorFile, 'utf-8')
        failJob(jobId, errorMsg)
        await unlink(errorFile).catch(() => {})
        const lockFile = path.join(RESULTS_DIR, `${jobId}.lock`)
        await unlink(lockFile).catch(() => {})
        return NextResponse.json({
          status: 'error',
          step: 'error',
          message: errorMsg,
          percent: 0,
          error: errorMsg,
        })
      } catch {
        // Keep waiting
      }
    }
  }

  return NextResponse.json({
    status: job.status,
    step: job.step,
    message: job.message,
    percent: job.percent,
    ...(job.status === 'done' ? { analysis: job.analysis } : {}),
    ...(job.status === 'error' ? { error: job.error } : {}),
  })
}