# Status of [need: name]

As of the 7:10 PM entry in `AGENT_LOG.md`, Saturday Nov 14. Update this after tonight's work and the iPad rehearsal.

Live page: https://tutor-1098c.web.app (Firebase Hosting). API: Cloud Run `tutor-api`, revision `00008`, model `gemini-3.5-flash`. Tests at the last entry: server 270 offline tests pass, web 350 tests pass.

## Works, and how it was tested

| Feature | How it was tested |
| --- | --- |
| Wrong step gets a red circle on the wrong term and a question | `e2e.py` against the live site, many runs (3.7 s, 4.4 s). Headless Chrome on the live domain. Preet on the iPad with the Pencil. |
| No repeat on an unchanged line; fixed line clears | `e2e.py` on the live site. |
| Two steps with a blank line between them are checked together | Fixed at 6:26 PM after a live failure. Headless canvas test. Not logged as re-tested on the iPad. |
| Finish an open line (`f'(x) =` gets `2x`) | Headless Chrome on the live site. |
| Help, three hint levels that differ | `e2e.py` on the live site (2.5 to 3.2 s each). |
| Graph beside the line (`plot2d`) | `e2e.py` on the live site. Seen on the iPad. |
| Teach me: lesson in a docked panel, plot animation, subtitles | Headless Chrome on the live site at 6:52 PM: lesson arrived, 9 narration clips returned 200, panel playing. Lessons on the real model: 7.0, 9.9, 10.2, 17.5 s. |
| Gemini TTS (`/api/speak`) | Returns a valid WAV on Cloud Run (5.1 s first call). |
| Voice question (hold Help) | Preet on the iPad, live link: speech input works. |
| Live link on venue wifi | Preet on the iPad, about 6:20 PM. |
| Save and reload a page (Firestore, `?page=<id>`) | Headless Chrome: written in one browser, restored in a fresh one. |
| Circuit read, solved, wrong answer circled | Full pipeline on a sketch-style image with `gemini-3.5-flash` (read 5.0 s, teach 6.9 s). Solver: 36 unit tests. |
| Full worked solution, server side | Cloud Run, real model: correct steps in 12.9 s and 22.9 s. |

## Built, not confirmed on a real iPad

- **Sound of the Gemini voice** and the iOS audio unlock. Clips are served; nobody has logged hearing them on the iPad.
- **Auto-continuing hints** (next hint after 18 s, countdown pill, prefetch). Tested in headless Chrome with a faked API only.
- **Help subtitles, placement that avoids ink and print, the status line** (commit `24208c5`, 7:09 PM). Tests pass. The log does not confirm the Hosting redeploy that carries them. Check the live page for the status line under "Show what AI read".
- **Direct answers to spoken questions and longer explaining hints.** Tested on the lite model through a local server. Deployed, not logged on the real model.
- **PDF worksheets.** Import and capture work in headless tests. On the iPad the hint aimed at the wrong printed problem and landed on the print. Fixes are deployed (targeting) or pushed (placement). Not re-tested on a real PDF.
- **Hand-drawn circuit on the live canvas.** One iPad attempt failed on the lite model ("no ground node"). The solver now picks a ground. Not re-tested from the iPad.
- **3D surfaces.** The server returns the spec and the shape renders in tests. Rotation by touch is untested, and so is a surface inside the lesson panel.
- **Log-axis plots** (`x_log`) in lessons. Drawn in headless tests only.

## Not finished

- **Full worked solution on the page.** The server sends a `solution` action. The page ignores it until the renderer lands (in progress tonight).
- **Write in my handwriting.** `/api/glyphs` and the page-side code exist. It is not wired in and is off. Character finding measured 55 of 59 on real Pencil pages with `gemini-3.5-flash`.

## Known bugs and limits

- A circle is narrowed to the wrong term by its position in the text. It is an estimate and can sit off on uneven handwriting.
- Lines more than about 6 line heights apart, or off to the side, are not sent together. The step then has nothing to be checked against and gets no mark.
- Lessons take 7 to 17.5 s. Full solutions took 12.9 and 22.9 s.
- The first request after idle is slower (about 7 s measured).
- If Gemini is busy, a call is retried and can time out. The page shows a quiet error and retries a failed check twice.
- If the checker returns `unknown`, Gemini may still mark a line when it is very sure. Only lines the checker called correct are protected in code.
- Hint history is kept in server memory per page. A restart or a second Cloud Run instance loses it, and hints may then repeat an idea.
- In the hint chain, erasing counts as writing, and a new `problem_id` for the next line ends the chain.
- `compute_step` could not parse "integral of 2x dx" written in words.
- `/api/debug/recent` is open to anyone. Firestore pages are readable by anyone with the page id. Remove or lock both after the weekend.
- `README.md` is out of date (it still says 6 actions, no 3D, and an untested demo set). The contract comment says a lesson has 3 to 7 steps; the server now sends 6 to 9.

## Sunday morning checklist

Before leaving home:

- [ ] iPad charged to 100%, charger and cable packed.
- [ ] Pencil paired and charged. Spare tip if there is one.
- [ ] Laptop charged, charger packed.
- [ ] The 2-minute video saved on the iPad and the laptop, and uploaded where Devpost can link it.
- [ ] Phone hotspot tested with the iPad.

At the table, 9:00 AM:

- [ ] Join venue wifi. Open `https://tutor-1098c.web.app/api/health` and expect `{"ok": true}`.
- [ ] Hard-reload the page so the newest build loads.
- [ ] Open a fresh page id: `https://tutor-1098c.web.app/?page=sun-1`. Use a new id for each judge (`sun-2`, `sun-3`).
- [ ] Run demo problem 1 once. This also warms up Cloud Run.
- [ ] Run problem 2 with Teach me. Set the iPad volume so the voice is clear over the room. Check the panel's mute button is off.
- [ ] Hold Help and say a short question, to trigger the microphone permission prompt before a judge is watching.
- [ ] Decide whether the circuit and the worksheet are in or out, from last night's rehearsal.
- [ ] If wifi is slow, switch the iPad to the hotspot and repeat problem 1.
- [ ] Fallback laptop address ready: on the laptop run `cd web && API_TARGET=https://tutor-api-191803288552.us-central1.run.app npm run dev`, then open `http://<laptop-ip>:5173` on the iPad (same network). Write the address on a sticky note. Voice questions do not work on this address because speech input needs https.
- [ ] iPad: Do Not Disturb on, auto-lock set to Never, Safari in full screen, other tabs closed.
- [ ] Pre-write problems 1 and 2 on the first page so the pitch starts without waiting.

Before 11:15 AM:

- [ ] Fill in `[need: name]` and the Zurich project's name and link in `docs/DEVPOST.md`.
- [ ] Submit on Devpost with the video link. Deadline is 11:30 AM. One track only: Best Integration of Gemini/Google API.
- [ ] No deploys after the last successful rehearsal.

During judging, 11:30 AM to 1:00 PM:

- [ ] Keep the video open in a tab on the laptop.
- [ ] Between judges: new page id, pre-write problems 1 and 2, check the battery.
- [ ] If the API returns errors, open `/api/debug/recent` on the laptop to see what the server read.
