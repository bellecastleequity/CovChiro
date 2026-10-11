# YouTube thumbnails (1280x720)

Built in code in the house style (navy/teal gradient, Outfit headline, real logo, real app and website screens, people cut-outs). See docs/brand/thumbnails.md for the rules.

Render all:   node marketing/thumbnails/thumbs.cjs          (writes marketing/thumbnails/out/, git-ignored)
Render some:  ONLY=01,08 node marketing/thumbnails/thumbs.cjs
Other folder: OUT=/some/dir node marketing/thumbnails/thumbs.cjs

- Edit the list `T` in thumbs.cjs: file name, audience pill, headline (*word* = teal), sub-line, person, and the visual (phone / desk / phone2 / shield).
- App screens come from dist/marketing/screenshots/ (test-site sample data). Website screens are in screens/.
- people/ are transparent cut-outs of the AI-generated models from the "Shake Up The Industry" Canva set (Oct 2026). Some are cropped on one side (asian-nurse, latina-nurse, pt-man, older-man, older-doc): put them where a phone covers that edge. glasses-man has a gap on the left; use as a head-and-shoulders crop only.
