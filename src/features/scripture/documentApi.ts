import type { Api } from "@/lib/api";
import type { SegmentWindow } from "@/types/library";

/**
 * The library's original viewers (`PdfViewer`, `EpubViewer`) read a source
 * through the library's commands, by source id (v0.23). A Bible kept as a
 * document is read with the very same viewers: this gives them an Api whose
 * reading commands open the Bible's document instead (its id in place of a
 * source id), so nothing of the viewers is copied or changed. Only reading
 * is redirected: no marks or citations are passed to the viewers here, and
 * Scripture references are not looked for in a Bible's own text.
 */
export function documentApi(api: Api): Api {
  return {
    ...api,
    libraryOriginalInfo: (id) => api.bibleDocumentInfo(id),
    libraryOriginalRead: (id, offset, length) => api.bibleDocumentRead(id, offset, length),
    libraryEpubStructure: (id) => api.bibleDocumentStructure(id, "epub"),
    libraryEpubItem: (id, item) => api.bibleDocumentItem(id, "epub", item),
    libraryDocxStructure: (id) => api.bibleDocumentStructure(id, "docx"),
    libraryDocxItem: (id, item) => api.bibleDocumentItem(id, "docx", item),
    libraryDetectReferences: async (_id, texts) => texts.map(() => []),
    sourceGetSegments: async ({ sourceId, offset, limit, aroundPage }): Promise<SegmentWindow> => {
      const window = await api.bibleDocumentSegments({ documentId: sourceId, offset, limit, aroundPage });
      return {
        sourceId,
        total: window.total,
        offset: window.offset,
        targetSegmentId: null,
        segments: window.segments.map((s) => ({
          id: `${sourceId}:${s.position}`,
          position: s.position,
          text: s.text,
          pageNumber: s.pageNumber,
          pageLabel: null,
          chapter: null,
          heading: null,
          sectionPath: s.sectionPath,
          paragraphIndex: null,
          locator: s.pageNumber !== null ? `p. ${s.pageNumber}` : (s.sectionPath ?? ""),
        })),
      };
    },
  };
}
