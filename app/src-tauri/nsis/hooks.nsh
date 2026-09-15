; NSIS hooks appended to the Tauri installer (bundle.windows.nsis.installerHooks).
; Tauri's own file-association macro already creates the MarkPDF.Document ProgID
; and points .pdf at it. Windows keeps the user's chosen default viewer
; (UserChoice), so on top of that we list MarkPDF under OpenWithProgids: that is
; what makes it show up in Explorer's right-click "Open with" menu.
; Keep this file ASCII only.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "MarkPDF.Document" ""
  WriteRegStr SHCTX "Software\Classes\MarkPDF.Document\shell\open" "FriendlyAppName" "${PRODUCTNAME}"
  ; SHCNE_ASSOCCHANGED: tell Explorer the associations changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "MarkPDF.Document"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
