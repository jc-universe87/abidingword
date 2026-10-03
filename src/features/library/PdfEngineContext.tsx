import { createContext, useContext, type ReactNode } from "react";
import { createPdfJsEngine } from "@/lib/pdfjsEngine";
import type { PdfEngine } from "@/lib/pdfEngine";

const defaultEngine = createPdfJsEngine();
const PdfEngineContext = createContext<PdfEngine>(defaultEngine);

/** Supplies the PDF renderer (the real one unless a test provides another). */
export function PdfEngineProvider({ engine, children }: { engine?: PdfEngine; children: ReactNode }) {
  return <PdfEngineContext.Provider value={engine ?? defaultEngine}>{children}</PdfEngineContext.Provider>;
}

export const usePdfEngine = () => useContext(PdfEngineContext);
