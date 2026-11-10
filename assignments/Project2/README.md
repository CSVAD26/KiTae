# Home Star Trails

> This README was written by Claude (Claude Code, Claude Fable 5.2) from the source code and the project's design notes. The personal reflection near the end is left for the author.

MAT236 Project 2, Data Portrait. A p5.js portrait of how far from home the author is at each hour of the day, drawn from one year of Google Maps Timeline data. Home changed during the year, so there are two dials.

## Concept

Each day is one trail on a 24-hour dial. The angle is the local time of day and the distance from the centre is the distance from home. Days are drawn on top of each other, so habits become bright bands and exceptions become thin lines.

In September 2026 the author moved from Korea to California to study, and no longer has a car. The portrait asks what that did to daily life: how far a normal day reaches, when the day starts, and how the author gets around.

## Data and pipeline

The data is the author's own Google Maps Timeline, exported on the phone (Android: Settings → Location → Location services → Timeline → Export Timeline data). The file covers 3 February to 10 November 2026: 281 days, 213 before the move and 68 after. It is read inside the browser and never uploaded. It is not in this repository (`.gitignore` excludes `data/` and Timeline files), because it contains every place the author has been, including home. Without a file the app shows a synthetic sample year.

The sketch follows the four stages of the visualization pipeline, all in `sketch.js`:

1. **Acquire.** `buildSample()` makes the synthetic year. The file input takes the real export: new phone exports from Android and iPhone, and older Takeout files.
2. **Parse.** `readTimeline()` pulls visits and travel segments out of the JSON. `readTime()` fixes the time zone: the export writes every timestamp in the phone's current zone and keeps the zone of that moment in a separate field, so without it the months in Korea would sit 16 to 17 hours off. `parseCoord()` reads the three coordinate notations found in these files.
3. **Clean.** `flattenVisits()` removes double counting when Google nests a building inside a larger place (1,940 visits become 1,811 pieces). `spotStays()` recovers gym visits from the GPS trail (see Process). `guessMove()` finds the date home changed. `rebuild()` groups visits into places on a grid, picks each period's home as the place with the most hours between midnight and 06:00, and measures every place's distance from that home. `ingest()` sorts the stays, removes overlaps, cuts them at midnight and labels the travel between them by mode.
4. **Represent.** `renderTrails()` draws all days into an offscreen buffer. `draw()` adds stars, labels and the highlighted day on top.

## Visual encoding

| Mark | Meaning |
|---|---|
| Angle | Local time of day. Midnight at the top, clockwise, 24 hours per turn |
| Radius | Distance from that period's home, on a log scale. Within 100 m counts as home |
| Arc | One stay at one place. Its length is how long it lasted |
| Star | One place, on its distance ring at the hour it is usually visited, sized by total time. The 12 places with the most time on each dial |
| Curve | Travel between two places, coloured by mode: on foot, bike, bus or train, car, flight |
| Two dials | Before the move on the left, after it on the right, on the same distance scale |
| Dashed ring | The reach of a typical day (median of each day's farthest point) |
| Inner to outer edge of a band | Earlier to later dates at the same place |
| Strip below | Farthest point of each day, with a line on the moving day |

## Interaction

- **Click a star** to keep only that place lit and open its panel: visits, total time, typical stay, usual arrival time, visits by weekday and month, first and last visit. The export has no place names, so a place can be named there (names stay in the browser), opened in Google Maps, or marked as home if the guess is wrong.
- **Hover a trail or the strip** to light one day. Click to pin it, then step through days with the arrow keys. Esc releases it.
- **Route of one day** lays the selected day out as one 24-hour bar, because order is hard to read on a circle.
- **Filter chips** switch weekdays, months and years on and off. **Summary** gives numbers per period and a month-by-month table. Clicking a month isolates it on the dials.
- **What counts as one place** switches the grouping range between 100 m, 300 m and 1 km. **Home changed on** shows the detected moving date and accepts a correction.

## Design principles

- **No map.** The piece draws distance from home, not coordinates. It shows the shape of a life without showing where home is.
- **Star trails.** In a long-exposure photograph of the night sky, time becomes angle and the pole star stays still. Here home is the pole star and each day is one trail around it.
- **Stays as arcs, places as stars.** A dot cannot show how long a visit lasted, and an arc cannot be picked out as a place, so both are drawn.
- **One scale.** Both dials share the same log scale, so their sizes can be compared directly.

## Process

- **Starting point.** The idea came from using an existing map-based Timeline viewer and wanting to redraw the same data without the map.
- **Four sketches.** The same data was sketched four ways: (A) a dial with circular time and distance as radius, (B) a year ribbon with horizontal time and distance as brightness, (C) an unrolled horizon with distance as height, and (D) a constellation where the unit is a place instead of a day. The final piece combines A and D.
- **The cost of a circle.** Arcs near the centre are short, so the many hours spent at home look small. The summary numbers and the one-day bar are there to balance that.
- **What is one place?** The answer changes the picture, so the grouping range is a control and not a fixed value.
- **The export is an interpretation, not a measurement.** Loading the real file showed three things the sample data could not. Google's HOME and WORK tags were wrong for the new home, so home is defined by where the nights are spent. Most time on campus is logged as one campus-wide place. And the gym was missing: Google recorded it as its own place only 4 times (4.1 hours), while whole workouts were stored as "cycling" that covers 115 to 155 m in 71 to 76 minutes. `spotStays()` now reads the GPS trail instead: any run of fixes that stays within 150 m of the recreation center for 20 minutes or more becomes a stay there. That finds 26 stays (31.9 hours) and makes the gym the fifth largest place on the second dial.

## Outcomes and reflection

| | Before the move (213 days) | After the move (68 days) |
|---|---|---|
| A typical day reaches | 5.2 km | 1.3 km |
| Trips by car | 44% | 24% |
| Trips on foot | 31% | 27% |
| Trips by bike | 0% | 42% |
| Trips by bus or train | 24% | 6% |
| Usually leaves home at | 10:42 | 11:05 |

The second dial is visibly smaller than the first, and its curves change from the orange of car trips to the colours of bike and foot.

Limits to keep in mind when reading it:

- Google's travel modes are guesses, and "car" means any ride in a car, not the author's own car.
- The smaller radius has more causes than the missing car: a different city, a campus, and a different stage of life.
- Home is "where the most night hours are spent". After the move Google logs about a third of the night hours as the campus-wide place, so time at home is understated on the second dial.
- Places are grid cells, not Google place ids, so neighbouring buildings can merge. Only one place, the gym, is recovered from the GPS trail, and a few early sessions with a single GPS fix are still missed.
- The log scale compresses long distances. Gaps longer than 30 hours are treated as missing data and are not drawn.

_Personal reflection (what these numbers mean to the author, what was expected and what was a surprise): to be added by the author._

## Running the project

```bash
cd assignments/Project2
python3 -m http.server 8001 --bind 127.0.0.1
```

Then open `http://localhost:8001`. The page starts with the synthetic sample. "Load my Timeline.json" reads an export from disk, and nothing leaves the browser. p5.js 1.9.4 is included in `libraries/`, so the app runs without a network connection (the fonts fall back to system fonts).

## Credits

- Assignment: based on "Quantified Selfie" in *Code as Creative Medium* by Golan Levin and Tega Brain.
- [p5.js](https://p5js.org) 1.9.4.
- Notes on the export format: the `mahlernim/google-timeline-visualizer` repository.
- Fonts: IBM Plex Sans, IBM Plex Mono and Instrument Serif.
- Location of the recreation center: OpenStreetMap.

## LLM use

The code and this README were produced with Claude. The first single-file version was made in a claude.ai chat. Claude Code (Claude Opus 5.5 and Claude Fable 5.2) then split it into files, checked it against the real export and added `spotStays()`.
