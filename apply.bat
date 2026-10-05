@echo off
rem Apply changes sent as .mbox files: drag one or more onto this file.
rem They are applied in the order given and committed. Pushing is up to you.
rem Each one that applies is deleted. If one does not apply, nothing from it
rem is kept, its file stays, and it stops there.
rem
rem It runs from a copy in the temp folder, because a change may rewrite this
rem very file, and cmd reads a batch file as it goes: rewriting it mid-run
rem garbles the rest. (No labels or goto either: cmd misreads those in a file
rem with Unix line endings.)
if not defined TW_APPLY_REPO (
  set "TW_APPLY_REPO=%~dp0"
  copy /y "%~f0" "%TEMP%\tw-apply.bat" >nul
  "%TEMP%\tw-apply.bat" %*
)
setlocal
cd /d "%TW_APPLY_REPO%"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo This file must sit in the Terrain Walker folder, next to tw.
  pause
  exit /b 1
)
rem The first version of this, apply-mbox.bat, rewrote itself as it ran.
if exist "apply-mbox.bat" (
  git rm -q -f apply-mbox.bat
  git commit -q -m "Remove apply-mbox.bat: apply.bat replaces it"
)
if "%~1"=="" (
  echo Drag one or more .mbox files onto apply.bat.
  pause
  exit /b 1
)
rem A half-finished earlier attempt blocks every later one: clear it first.
if exist ".git\rebase-apply" (
  echo An earlier attempt was left half done. Undoing it first.
  git am --abort
)

set FAILED=
for %%F in (%*) do (
  if not defined FAILED (
    echo.
    echo ===== %%~nxF
    git am -3 "%%~F"
    if errorlevel 1 (
      git am --abort
      set FAILED=%%~nxF
    ) else (
      del "%%~F"
    )
  )
)

echo.
if defined FAILED (
  echo %FAILED% did NOT apply, and nothing from it was kept. The file is still there.
  echo Usually an earlier change is missing: apply that one first.
  echo Anything listed above it applied fine, and its file was deleted.
  pause
  exit /b 1
)
echo All applied.
timeout /t 3 >nul
