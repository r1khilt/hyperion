import catalog from "@/data/models/catalog.json";
import fineTunes from "@/data/models/fine-tunes.json";
import { NextResponse } from "next/server";
export function GET() { return NextResponse.json({ ...catalog, fineTunes: fineTunes.fineTunes }); }
