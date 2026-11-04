# Substitute fonts

Open-licensed stand-ins embedded when a subtitle uses a font that its group did not upload and
that Android does not have (it falls back to Roboto otherwise). The ASS script is rewritten to
name the substitute, the substitute fonts themselves are not renamed.

| Original | Substitute | License |
|---|---|---|
| Arial, Helvetica | Liberation Sans 2.1.5 (metric-compatible) | SIL OFL 1.1, `liberation/OFL.txt` |
| Times New Roman, Times | Liberation Serif 2.1.5 (metric-compatible) | SIL OFL 1.1, `liberation/OFL.txt` |
| Courier New, Courier | Liberation Mono 2.1.5 (metric-compatible) | SIL OFL 1.1, `liberation/OFL.txt` |
| Comic Sans MS | Comic Neue | SIL OFL 1.1, `comic-neue/OFL.txt` |
| Trebuchet MS | Fira Sans | SIL OFL 1.1, `fira-sans/OFL.txt` |

Sources: https://github.com/liberationfonts/liberation-fonts (release 2.1.5) and
https://github.com/google/fonts (`ofl/comicneue`, `ofl/firasans`).
