import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Lets the client know whether live voice is available or it should offer demo mode. */
export function GET() {
  return NextResponse.json(
    {
      liveVoice: Boolean(process.env.OPENAI_API_KEY),
      accessCodeRequired: Boolean(process.env.APP_ACCESS_CODE),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
