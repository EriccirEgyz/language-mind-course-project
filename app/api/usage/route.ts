import { NextResponse } from "next/server";
import { readUsage } from "../../../lib/usage";

export async function GET() {
  const usage = await readUsage();
  return NextResponse.json(usage);
}
