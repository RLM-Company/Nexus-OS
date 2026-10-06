# Composer and Studio Files — 2026-10-06

The main chat now uses an accessible paperclip for text, code, PDF, DOCX, PNG and JPEG, with image thumbnails and removable attachment chips. Keyboard hints, provider configuration badges and the persistent execution-stop banner were removed from the main chat. The execution gate still prevents requests during a stop or when evidence is unavailable; model details remain in the account menu. Search is an optional compact icon and expands only on request.

Cosmora Studio → Крупные файлы is a functional local document workspace. It reads UTF-8 text/code, PDF and DOCX, shows file statistics and Markdown headings, searches the complete extracted text, provides numbered parts and downloads the complete extracted text. Files are not stored on the server or persisted in browser storage. Leaving the section discards its document; cancelling or replacing a pending read invalidates the old operation.

Bounds: one file up to 20,000,000 bytes, extracted text up to 2,000,000 UTF-16 code units, PDF up to 500 pages with a 60-second reader deadline, DOCX document XML up to 8,000,000 expanded bytes. Password-protected documents, image-only scans/OCR and arbitrary binary formats are unsupported. Oversized or invalid documents produce an error; no silent truncation occurs.

“Разобрать эту часть в чате” prepares a new ordinary chat with the question and one selected text attachment. It does not start a model request. Parts contain up to 4,500 code units, preserve surrogate pairs and fit the existing attachment byte budget. The question explicitly identifies the selected part and prohibits conclusions about unread parts. This is not an automatic AI review of the entire document. Only explicitly sending the prepared message would invoke the configured model when execution is permitted.

The existing owner login, runtime credentials and production emergency stop are retained. No paid calls or payments are required for local reading and verification.

Parallel GitHub/Code work uses a separate checkout and draft PR. Its changes are not included in this release without review and integration.
