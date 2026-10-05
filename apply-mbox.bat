@echo off
rem Apply changes sent as .mbox files: drag one or more onto this file.
rem They are applied in the order given and committed, ready to push.
rem If one does not apply, nothing from it is kept and it stops there.
rem (No labels or goto on purpose: cmd misreads those in a file saved with
rem Unix line endings, which is how git may write this one.)
setlocal
cd /d "%~dp0"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo This file must sit in the Terrain Walker folder, next to tw.
  pause
  exit /b 1
)
if "%~1"=="" (
  echo Drag one or more .mbox files onto this file.
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
    git am "%%~F"
    if errorlevel 1 (
      git am --abort
      set FAILED=%%~nxF
    )
  )
)

echo.
if defined FAILED (
  echo %FAILED% did NOT apply, and nothing from it was kept.
  echo Usually an earlier change is missing: apply that one first.
  echo Anything listed above it applied fine.
  pause
  exit /b 1
)
echo All applied.
choice /c YN /m "Push to GitHub now"
if errorlevel 2 (
  echo Not pushed. Push later with: git push
) else (
  git push
)
pause
