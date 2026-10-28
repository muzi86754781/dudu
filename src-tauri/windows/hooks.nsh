; dudu NSIS Installer Hooks
; Enables direct in-place upgrade and overwrite without uninstalling previous versions.

!macro NSIS_HOOK_PREINSTALL
  ; Terminate any existing dudu.exe instances to release file locks before installation
  nsExec::Exec 'cmd.exe /c taskkill /F /IM dudu.exe /T >nul 2>nul'
  Sleep 600
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Run the newly installed application
  Exec '"$INSTDIR\dudu.exe"'
!macroend
