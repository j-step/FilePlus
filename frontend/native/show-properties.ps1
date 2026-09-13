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
# Windows PowerShell 5.1 has no `??` / ternary -- written as plain if/else.
param([Parameter(Mandatory=$true)][string]$Path)

$item = Get-Item -LiteralPath $Path -Force

if ($item.PSIsContainer) {
    $parentPath = Split-Path -LiteralPath $Path -Parent
} else {
    if ($item.DirectoryName) {
        $parentPath = $item.DirectoryName
    } else {
        $parentPath = $item.Parent.FullName
    }
}

$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace($parentPath)
$target = $folder.ParseName($item.Name)
$target.InvokeVerb("Properties")

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

$title = "$($item.Name) Properties"
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
