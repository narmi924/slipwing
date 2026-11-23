# Keep-typing check

`Run-KeepTyping.ps1` checks that `slipwing run` leaves the user's window alone. A note window in front receives a
character every 150 ms while the script fills and saves a WinForms register window behind it. It passes when the
register saved once with the right values, the note never lost the foreground, the cursor never moved, no key or
click came from another program, and every typed character reached the note. It exits 2 without touching anything
when the keyboard or mouse was used in the last 60 s.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\keep-typing\Run-KeepTyping.ps1
```
