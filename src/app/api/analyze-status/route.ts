import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '@/lib/analysis-jobs'

export const dynamic = 'force-dynamic'

/**
 * GET: Poll analysis job status.
 * Query: ?jobId=xxx
 * Returns: { status, step, message, percent, analysis?, error? }
 */
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId')

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 })
  }

  const job = getJob(jobId)

  if (!job) {
    return NextResponse.json({ error: 'Job not found or expired' }, { status: 404 })
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