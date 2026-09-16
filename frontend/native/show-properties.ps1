# frontend/native/show-properties.ps1
#
# Opens the native Windows "Properties" dialog for -Path via the shell
# verb, then blocks so the process this script runs in (spawned detached,
# hidden, from main.js's showProperties bridge handler) stays alive for as
# long as the dialog is open. If this process exited immediately after
# InvokeVerb, the Shell.Application COM object it created would be torn
# down with it and could take the dialog with it (confirmed by hand: killing
# the invoking process closes the property sheet with it).
#
# -ResolveOnly resolves the parent folder and the shell item, prints them and
# exits 0 without invoking anything -- the regression test
# (tests/test_show_properties_ps1.py) drives the real resolution path with it
# instead of popping a modal dialog on the test machine.
#
# Every failure path exits non-zero: main.js waits briefly for an early exit
# and reports it back, so properties.js can toast instead of the user getting
# absolute silence (pass 2 #147).
#
# Windows PowerShell 5.1 has no `??` / ternary -- written as plain if/else.
param(
    [Parameter(Mandatory=$true)][string]$Path,
    [switch]$ResolveOnly
)

$ErrorActionPreference = 'Stop'

try {
    $item = Get-Item -LiteralPath $Path -Force

    if ($item.PSIsContainer) {
        # NOT Split-Path -LiteralPath ... -Parent: -Parent belongs to the
        # `Path` parameter set and -LiteralPath to the `LiteralPath` one, so
        # that combination is an AmbiguousParameterSet error in Windows
        # PowerShell 5.1 -- Properties never opened for ANY folder (pass 2
        # #147). GetDirectoryName is literal by construction.
        $parentPath = [System.IO.Path]::GetDirectoryName($item.FullName.TrimEnd('\', '/'))
    } else {
        if ($item.DirectoryName) {
            $parentPath = $item.DirectoryName
        } else {
            $parentPath = $item.Parent.FullName
        }
    }

    $shell = New-Object -ComObject Shell.Application
    if ([string]::IsNullOrEmpty($parentPath)) {
        # A drive root (C:\) has no parent directory: its shell parent is
        # "This PC" (ssfDRIVES = 17), where the item is parsed by its full
        # path. Namespace('') is $null, which used to throw one line later.
        $folder = $shell.NameSpace(17)
        $childName = $item.FullName
    } else {
        $folder = $shell.Namespace($parentPath)
        $childName = $item.Name
    }
    if ($null -eq $folder) { throw "Shell namespace not available for '$parentPath'." }

    $target = $folder.ParseName($childName)
    if ($null -eq $target) { throw "Shell could not resolve '$childName' in '$parentPath'." }

    # The dialog's own title uses the shell display name (which differs from
    # the filename when extensions are hidden, and entirely for a drive:
    # "Local Disk (C:)"), and the wait loop below matches on it.
    $title = "$($target.Name) Properties"

    if ($ResolveOnly) {
        Write-Output "parent=$parentPath"
        Write-Output "target=$($target.Name)"
        exit 0
    }

    $target.InvokeVerb("Properties")
} catch {
    Write-Error $_
    exit 1
}

# The dialog lives in this process: wait until its window is gone.
#
# Get-Process's MainWindowTitle is NOT reliable here -- verified by hand
# (frontend/native, manual check log): InvokeVerb("Properties") hands the
# property sheet to a shell-hosted window that Get-Process | Where-Object
# { $_.MainWindowTitle -eq $title } never matches, even while the window is
# confirmed on-screen via raw EnumWindows/GetWindowText. So this polls the
# desktop's top-level windows directly by title through user32 FindWindow,
# which does find it.
Add-Type -Namespace FilePlus -Name NativeMethods -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
'@

$deadline = (Get-Date).AddMinutes(30)
# InvokeVerb hands off to the shell asynchronously -- give the dialog up to
# 10s to actually appear before concluding there is nothing to wait on (e.g.
# no property-sheet handler registered for this item type).
$appearBy = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $appearBy -and [FilePlus.NativeMethods]::FindWindow($null, $title) -eq [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 300
}

do {
    Start-Sleep -Milliseconds 400
} while ((Get-Date) -lt $deadline -and [FilePlus.NativeMethods]::FindWindow($null, $title) -ne [IntPtr]::Zero)
