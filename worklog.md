---
Task ID: 1
Agent: Main
Task: Redesign SpikeLab website to use video upload + AI analysis instead of manual subjective slider input

Work Log:
- Read the original website at https://f1hbc5f5qrv1-d.space-z.ai/ using web-reader and agent-browser
- Identified the core issue: 15 biomechanical checkpoints were rated via manual sliders (subjective self-assessment)
- Read VLM and video-understand skill documentation
- Created type definitions at `/home/z/my-project/src/lib/spike-types.ts`
- Built VideoUploader component at `/home/z/my-project/src/components/spike/VideoUploader.tsx` (drag-and-drop, preview, analyzing overlay)
- Rewrote `/home/z/my-project/src/app/page.tsx` with new video-first UI flow:
  - Hero section with updated copy ("Upload your spike. Get the truth.")
  - Tab 1: Minimal player profile + video upload (replaced 15 sliders)
  - Tab 2: Analysis results view (circular score gauge, phase cards, all 15 checkpoints, strengths/weaknesses)
  - Tab 3: Training plan view (4-week plan with daily drills)
  - Features section and Science section preserved and updated
- Created `/home/z/my-project/src/app/api/analyze-spike/route.ts` - VLM video analysis API
  - Accepts multipart video upload + player profile
  - Converts video to base64 data URI for VLM
  - Detailed biomechanical analysis prompt with JSON output structure
  - Validates and clamps all 15 scores
- Created `/home/z/my-project/src/app/api/generate-plan/route.ts` - LLM training plan generation
  - Takes analysis results + profile context
  - Generates structured 4-week training plan with daily drills
- Updated layout metadata for SpikeLab branding
- Verified: lint passes, no console errors, desktop + mobile responsive

Stage Summary:
- Replaced 15 manual subjective sliders with AI video analysis
- Full video upload → AI analysis → training plan pipeline
- Two API routes: /api/analyze-spike (VLM) and /api/generate-plan (LLM)
- Clean UI with shadcn/ui, framer-motion animations, responsive design
- Sticky footer, semantic HTML, accessible