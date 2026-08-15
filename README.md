<p align="center">
  <img src="plid.svg" alt="PLID" width="264" height="84">
</p>

<h1 align="center">PLID — Prefix-Lexicographic ID</h1>

A PLID is a variable-width, lexicographically sortable identifier. A 46-bit Unix
millisecond timestamp and a 2-bit local-date offset occupy exactly the first 8
characters; each further character adds 6 bits of entropy.

```
PLID-12 (K=4)

  1d0LFaLM  8fLm
  └──────┘  └──┘
  46 + 2     24 bits
  ms   date  entropy
       offset
```

Like ULID and UUIDv7 it is a time-ordered identifier, and it is put to the same
work. What it adds is a local-date field and a choice of widths, at a lower
price per bit: 6 bits per character against Crockford base32's 5. Where 80
random bits is more than the keyspace needs, PLID-12 carries 24 in 12 characters
against a ULID's 26 — under half the length. What it is for:

- **Primary keys that sort by creation.** Inserts land at the end of the index
  instead of scattering it the way a random UUID does, and `ORDER BY id` is
  creation order — no `created_at` column, no second index (§ 5).
- **Range scans and pagination on the key itself.** A time window is
  `WHERE id >= stamp(:t0) AND id < stamp(:t1)` (§ 5.2), a page is
  `WHERE id > :cursor ORDER BY id`, and a 6- or 7-character prefix is a
  ready-made log or partition bucket of about a second or 16 ms (§ 5.1).
- **Minting anywhere, with no coordination.** No node registry and no central
  sequence: browsers, edge workers and short-lived jobs each seed from a CSPRNG
  and stay apart on probability (§ 3.1).
- **Reporting on the minter's calendar day.** The 2-bit offset records which
  local date an ID belongs to — a fact a timestamp alone cannot recover
  afterwards — so "orders on the customer's Tuesday" needs no second column
  (§ 2.3).
- **Widening without a migration.** Profiles interoperate in one text column, so
  `K` can grow with the write rate while old rows keep sorting (§ 5.3).

What it is **not** for: bearer tokens, or public identifiers where the creation
time is sensitive. A PLID is a key, not a secret (§ 6).

---

## 1. Alphabet

64 characters, strictly ascending by ASCII code point:

```
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~
```

| Index | Characters | Code points |
|-------|-----------|-------------|
| 0–9   | `0`–`9`   | 0x30–0x39 |
| 10–35 | `A`–`Z`   | 0x41–0x5A |
| 36    | `_`       | 0x5F |
| 37–62 | `a`–`z`   | 0x61–0x7A |
| 63    | `~`       | 0x7E |

Ascending order is what makes byte-order comparison equal numeric comparison.
**Do not substitute base64url**: its index 0 is `A` at 0x41 while its index 62
is `-` at 0x2D, so encoding a monotonic value with it produces strings that do
not sort. Since this is a pure per-symbol substitution on standard base64, an
implementation may encode with a stock base64url encoder and apply a 64-entry
translation table.

Both non-alphanumerics are RFC 3986 *unreserved*, so a PLID is URL-safe with no
escaping. The alphabet is **case-sensitive** and has no case-folding rule;
decoders must not apply one.

---

## 2. Layout

```
total bits = 48 + 6K     text length = 8 + K characters     0 ≤ K ≤ 24
```

| Field       | Width  | Position   | Contents |
|-------------|--------|------------|----------|
| Timestamp   | 46     | high bits  | Unsigned milliseconds since the Unix epoch, big-endian |
| Date offset | 2      |            | Local calendar date relative to the UTC date, per § 2.3 |
| Entropy     | 6K     | low bits   | Per § 3 |

```
stamp = (ms << 2) | offset          the 48-bit value in the first 8 characters
```

A PLID is **8 to 32 characters**. The floor is the stamp itself; the ceiling is
past PLID-16, the widest profile listed below, and past UUIDv4's 122 random
bits, which PLID-32 clears with 144. Readers and writers hold to the same range:
text outside it is not a PLID.

The timestamp is plain Unix time — no custom epoch, no conversion table, no era
rules. Forty-six bits of milliseconds run 2,230 years: the field exhausts on
**4199-11-24**.

Because 48 is divisible by 6, no character straddles the boundary with the
entropy field: the first 8 characters are the stamp and nothing else. 46 is not
divisible by 6, so the offset shares character 8 with the low 4 bits of the
millisecond — character 8 is `((ms & 15) << 2) | offset`, not readable as an
offset on its own.

ULID and UUIDv7 carry a 48-bit millisecond in the same leading position, so a
PLID stamp is *nearly* their field but not bit-identical. Converting shifts the
millisecond 2 bits and fills the offset with `0`, "not encoded" (§ 2.3) — the
honest value, since neither format records one.

### 2.1 Text form

Always emit exactly `8 + K` characters, zero-padded on the left. Never trim
leading `0` characters: fixed width within a profile is what makes lexicographic
sorting valid.

The leading character advances every 2^40 ms — about **34.8 years**. It left `0`
on 2004-11-03, so IDs minted now begin with `1`; the next rollover, to `2`, is
2039-09-07. Because indices 0–9 are digits, a PLID leads with a digit until
2318-06-04, which is why the alphabet places digits at the bottom.

### 2.2 Profiles

| Form | K | Bits | Entropy values | Binary | Notes |
|------|---|------|----------------|--------|-------|
| PLID-8  | 0 | 48 | — | 6 bytes | Stamp only — **not an identifier** (§ 5) |
| PLID-9  | 1 | 54 | 64 | — | Two generators collide readily (§ 3) |
| PLID-10 | 2 | 60 | 4,096 | — | Fits a signed 64-bit integer |
| PLID-11 | 3 | 66 | 262,144 | — | |
| PLID-12 | 4 | 72 | 16,777,216 | 9 bytes | **Recommended default** |
| PLID-13 | 5 | 78 | 1.07 × 10⁹ | — | |
| PLID-14 | 6 | 84 | 6.87 × 10¹⁰ | — | |
| PLID-16 | 8 | 96 | 2.81 × 10¹⁴ | 12 bytes | |

Byte alignment occurs when `K` is a multiple of 4. Other widths must be
left-padded with zero bits for binary storage; leading zero bits preserve
`memcmp` order.

### 2.3 Date offset

A Unix millisecond is an instant, not a date. Nothing in it says which *local
calendar day* it fell on, and a reader cannot recover that afterwards: applying
the reader's timezone retroactively gives the wrong day for anything minted
before a trip, across a DST boundary, or on another device. The offset field
records the answer at mint time, while it is still known.

Relative to the UTC date of the same instant, a local calendar date can only be
one of three things:

| Bits | Offset | Meaning |
|------|--------|---------|
| 0 | — | **Not encoded.** The generator had no local calendar |
| 1 | −1 | The local date is the day *before* the UTC date |
| 2 | 0 | The same date |
| 3 | +1 | The day *after* |

```
localDate = utcDate(ms) + (bits − 2)                     for bits ≥ 1
```

Three states, so ⌈log₂ 3⌉ = 2 bits. That the three are *exhaustive* is not a
fact about which zones happen to exist: for any UTC offset strictly inside ±24
hours, `(t + offset) / 86400` and `t / 86400` are less than 1 apart, so the two
calendar dates differ by at most one day. Half-hour and 45-minute zones, DST
shifts and historical zone changes all sit comfortably inside that bound.

The second bit is what the real range of civil offsets costs. For most instants
only two outcomes are reachable and one bit would do — but from **10:00 to 12:00
UTC** all three are live at once. At 10:00 UTC, Kiritimati (UTC+14) has already
turned over to the next date while Baker Island (UTC−12) does not reach the same
date until 12:00 UTC, and everything between is on the UTC date. One bit cannot
span that window, so the field is 2 bits everywhere rather than
context-dependent.

Bits `0` is a genuine fourth state, not a spare encoding. A generator with no
user-facing calendar — a server minting for clients in unknown zones — MUST
write `0` rather than guess `2`, and a decoder MUST surface it as unknown rather
than collapse it into the other three.

Two limits on what the field claims. It records the *generator's* local date,
never the reader's; two devices in different zones legitimately stamp the same
millisecond with different offsets. And it encodes only the date relation — not
the timezone, not the UTC offset in hours, neither recoverable from 2 bits.

---

## 3. Entropy field

Two rules, at every width, with no cases:

- On a new stamp, seed the field with all `6K` bits from a CSPRNG.
- For each subsequent ID at the same stamp, increment by 1.

Strictly monotonic and collision-free within a generator. Both rules are stated
over the 48-bit stamp rather than the millisecond because the offset bits can
change *within* a millisecond, and that is a new stamp with a new basis for the
counter (§ 4).

Whatever the seed leaves between itself and the top of the field is the room the
counter has: half the field on average, occasionally almost none, at which point
§ 4 borrows a millisecond and the timestamp runs briefly ahead of the clock.

The seed is redrawn on every new stamp — so at least once per millisecond, and
nothing accumulates across them. Within one stamp the field is a plain counter,
which is exactly as revealing as it sounds (§ 6).

### 3.1 Choosing K

The rules do not change with `K`, only what they buy. The seed separates
independent generators; the room above it is what one generator can spend inside
a millisecond. Both come from the same `6K` bits:

| Form | Seed values | Typical room per ms | Chance a ms starts with < 100 left |
|------|-------------|---------------------|------------------------------------|
| PLID-8  | — | 0 | always |
| PLID-9  | 64 | 32 | 100% |
| PLID-10 | 4,096 | 2,048 | 2.4% |
| PLID-11 | 262,144 | 131,072 | 0.04% |
| PLID-12 | 1.7 × 10⁷ | 8.4 × 10⁶ | 0.0006% |
| PLID-14 | 6.9 × 10¹⁰ | 3.4 × 10¹⁰ | ~0 |
| PLID-16 | 2.8 × 10¹⁴ | 1.4 × 10¹⁴ | ~0 |

**K ≥ 4 is the recommended range**, and both columns say why. At K=4 the seed is
one of 16.7 million — separation worth having between uncoordinated generators —
and a millisecond effectively never begins short of room. Below it both fail
together: PLID-9's 64 seeds collide constantly between two generators and leave
a median of 32 IDs before borrowing. Narrow profiles suit a single low-rate
generator, or node mode.

Monotonicity and collision-freedom are both **per generator**. Across
independent generators the only protection is the seed: for two emitting in the
same millisecond the collision chance is on the order of one in 2^6K — one in 17
million at K=4, one in 2.8 × 10¹⁴ at K=8 — scaled by how many IDs each emits in
that millisecond. Ample for human-paced writers; uncoordinated high-rate
generators sharing a keyspace want a wider profile or node mode.

### 3.2 Random mode

All `6K` bits drawn per ID, no counter. Stateless and parallel-safe, but not
monotonic within a millisecond and subject to birthday collisions:

| Form | 1% collision at | 50% collision at |
|------|-----------------|------------------|
| PLID-9  | 2 | 10 |
| PLID-10 | 10 | 76 |
| PLID-11 | 74 | 604 |
| PLID-12 | 582 | 4,823 |
| PLID-13 | 4,647 | 38,582 |
| PLID-14 | 37,167 | 308,652 |
| PLID-16 | 2,378,622 | 19,753,663 |

Counts are IDs generated *within a single millisecond*. Use random mode only at
low volume and always behind a unique constraint — the table says what "low
volume" means at each width.

### 3.3 Node mode

For coordinated generators, split the field: top bits an assigned node ID,
remainder a per-millisecond counter. Collision-free given unique assignment, and
entirely predictable. Internal keys only.

---

## 4. Clock regression

A generator MUST NOT emit a stamp lower than one it has already emitted. The
rule covers the whole 48-bit stamp, offset bits included, not the millisecond
alone. Retain the last emitted value `lastStamp`:

- If `(now << 2) | offset` exceeds `lastStamp`, advance to it and reseed the
  entropy field.
- If it is `≤ lastStamp` (NTP step-back, leap smear, VM migration, a timezone
  change, or simply the same millisecond), keep `lastStamp` and advance the
  entropy field.
- On entropy overflow, add **4** to `lastStamp` — one millisecond, offset bits
  untouched — and reseed, borrowing a future millisecond. Adding 1 would corrupt
  the offset instead of advancing time.

This preserves monotonicity across clock faults at the cost of IDs briefly
running ahead of real time.

Comparing stamps rather than milliseconds costs nothing and closes one real
hole. For a fixed zone the offset rises at local midnight and falls at UTC
midnight, both exact millisecond boundaries, so the offset never changes *within*
a millisecond and the two rules coincide. They diverge only when a device
reconfigures its zone between two IDs in the same millisecond, where the offset
can fall — a regression the stamp rule absorbs like any other.

`lastStamp` lives in generator memory, so the guarantee spans one generator
lifetime: a process restarted after a clock step-back will emit stamps below IDs
it emitted before the restart. Where ordering must survive restarts — IDs keying
an append-only log, for instance — initialize `lastStamp` from the largest ID
already emitted, one lookup of the store's maximum key, rather than from the
wall clock (§ 7).

---

## 5. Sorting

Everything here follows from one property: byte order equals creation order.

### 5.1 Prefixes

`substring(id, 1, 8)` is a complete PLID-8 and decodes to the millisecond and
offset directly. Every shorter prefix denotes a contiguous time bucket, an
`n`-character prefix spanning `2^(46 − 6n)` milliseconds — through `n = 7`,
since the last two bits divide by offset rather than by time:

| Prefix chars | Bucket |
|--------------|--------|
| 1 | 34.8 years |
| 2 | 199 days |
| 3 | 3.1 days |
| 4 | 70 minutes |
| 5 | 66 seconds |
| 6 | 1.02 seconds |
| 7 | 16 ms |
| 8 | 1 ms at one offset |

A 6- or 7-character prefix is a natural log-partition key. Characters 1 and 2
change every 34.8 years and 199 days, so index-prefix selectivity is negligible
until the third.

The last row is where the offset shows. A full 8-character prefix pins the
millisecond *and* the offset, so matching one selects a quarter of a
millisecond's IDs. A whole millisecond is the 46-bit prefix, which is not a
character boundary: it is the four adjacent PLID-8 values `1d0LFaLK` through
`1d0LFaLN`, and selecting it takes a range.

### 5.2 Time-range queries

Because PLID-8 is a literal prefix, range bounds need no padding — any longer
PLID beginning with a given stamp sorts after the bare form:

```sql
WHERE id >= stamp(:t0) AND id < stamp(:t1)
```

An index range scan, removing the need for a separate `created_at` column or a
functional index.

The pattern survives the offset field because `stamp` writes offset bits `0`,
the *minimum* of the four: the lower bound sorts below every ID minted at `t0`
whatever its offset, and the upper bound below every ID minted at `t1`. The
half-open range stays exactly `[t0, t1)` in milliseconds, with no offset leaking
in or out at either end.

**PLID-8 is not an identifier.** It carries no entropy and collides for every
row created in the same millisecond and zone. Its uses are range bounds and
partition keys.

### 5.3 Mixed widths

Profiles interoperate in a single text column: the shared 8-character stamp
prefix decides every comparison between distinct milliseconds, and within one
millisecond the relative order of different widths is arbitrary but stable. A
table's generator may therefore be widened in place, with no backfill.

Two constraints: binary columns are fixed-width, so this applies to text storage
only; and a shorter PLID may be a strict prefix of a longer one, which confuses
prefix-matching logic that assumes IDs are never nested.

Truncation is well-defined — dropping trailing characters yields a valid shorter
PLID with the same timestamp and preserved sort order. The offset survives it,
sitting inside the first 8 characters.

### 5.4 Storage

| Storage | Requirement |
|---------|-------------|
| PostgreSQL text | `char(8+K) COLLATE "C"` |
| PostgreSQL binary | `bytea`, left-padded |
| MySQL text | `BINARY(8+K)` or a `_bin` collation |
| JavaScript / IndexedDB | Plain string — default code-unit order is byte order |
| Integer | PLID-10 only, as signed 64-bit |

**Collation is not optional.** Under `en_US.UTF-8`, ICU and glibc treat case as
a tertiary weight and may ignore punctuation at the primary level, so `ORDER BY
id` on a default-collation column silently stops matching creation order.
MySQL's default collations — `utf8mb4_0900_ai_ci` since 8.0,
`utf8mb4_general_ci` before — are case-insensitive, which additionally makes a
`UNIQUE` index reject IDs differing only in case. Pin `COLLATE "C"`, use
a `_bin` collation, or store the binary form and let `memcmp` do the work.

JavaScript needs no pinning: `<`, `Array.prototype.sort` and IndexedDB key
comparison all order by UTF-16 code unit, which for this all-ASCII alphabet is
byte order. `localeCompare` and `Intl.Collator` reintroduce exactly the locale
behavior above — never sort IDs with them.

---

## 6. Limitations

**A PLID is a key, not a secret.** Even PLID-16's 48 entropy bits are guessable
by a networked attacker, and narrow profiles have next to none — PLID-9's whole
field is 64 values. Anything acting as a bearer token needs a separate random
value.

**A PLID discloses its creation time** to the millisecond. For public-facing
URLs the standard pattern is two columns: a PLID for the internal key and index
locality, and a random identifier (Nano ID, UUIDv4) for external reference.

**Within one stamp the entropy field is a counter, and says so.** Given one ID,
the next that generator mints at the same stamp is that value plus one, and the
difference between two of them is the exact number minted in between — the
invoice-number leak, at millisecond scale. It goes no further: the seed is
redrawn on every new stamp, so IDs from different milliseconds disclose no
volume at all. Where in-millisecond volume is itself sensitive, use random mode
behind a unique constraint, which accumulates nothing.

**The offset narrows the minter's timezone.** Combined with the timestamp it
constrains the zone, not just the date: an ID stamped +1 at 10:30 UTC can only
have come from a zone at or east of UTC+13:30. One ID says little; a handful
across the day intersect to a narrow band. Where the creation time is already
too much to disclose this adds nothing; where it is not, it is a reason to keep
the second column above.

**Not filename-safe on case-insensitive filesystems.** APFS and NTFS treat
`1d0LFaLM8fLm` and `1d0lfalm8flm` as the same path.

**Not suited to human transcription.** The alphabet contains `0`/`O`,
`1`/`l`/`I` and both cases of everything. For IDs read aloud or typed from
paper, use Crockford Base32 and accept the extra characters.

**`~` may be percent-encoded** by implementations predating RFC 3986. Legal and
round-trips correctly, but longer in transit.

**The timestamp carries slack.** The 46-bit field resolves 2,230 years, of which
roughly 2.5% will be used. A 40-bit field with a recent epoch would free a
further character, at the cost of prefix alignment, Unix-epoch interop and safe
mixed-width storage.

---

## 7. The `plid` package

This repository is the reference implementation: TypeScript, ESM, no runtime
dependencies. `test/` is the conformance suite — the worked examples, field
boundaries, rollover dates and prefix buckets quoted above are asserted there.
The statistical tables in § 3 are derived rather than measured, and random and
node mode are described but not implemented, so nothing asserts those.

```
npm install plid
```

The package is **ESM-only**. `import` works everywhere; `require("plid")` works
from Node 20.19 and 22.12, where `require(esm)` landed, and needs a dynamic
`import()` before that — as does a TypeScript CommonJS file under `node16` resolution.

Most of the time, one function:

```ts
import { plid } from "plid";

const id = plid();     // "1d0LFaLM8fLm" — PLID-12, the recommended default

// Byte order is creation order, so the key is also the sort key and the cursor:
//   SELECT * FROM orders ORDER BY id LIMIT 50
//   SELECT * FROM orders WHERE id > :cursor ORDER BY id LIMIT 50
```

The rest of the surface, in one place:

```ts
import {
  plid, stamp, timestamp, createGenerator, decode, offset,
  localDate, localDateKey, driftMs, isPlid, dateOffset, MAX_MS,
} from "plid";

plid(16);                       // "1d0LFaLMiTMmi4gU" — a wider profile
plid(12, 0);                    // no local calendar to speak of: offset bits 0

timestamp("1d0LFaLM8fLm");      // 1786795496789 — the millisecond it was minted

// One day's rows, off the primary key alone (§ 5.2):
const t0 = Date.parse("2026-08-16T00:00:00Z");
const [lo, hi] = [stamp(t0), stamp(t0 + 86_400_000)];   // "1d0VUF00", "1d0p4b00"
//   SELECT * FROM orders WHERE id >= :lo AND id < :hi

// Your own generator: injected clock, zone and seed, plus § 4's restart floor.
const g = createGenerator({ length: 16, since: await store.maxId() });
g.next();                       // "1d0LFaLMFTw5eqtq"
g.next();                       // "1d0LFaLMFTw5eqtr" — the next in the same stamp
g.next(0);                      // this one records "no local calendar" (§ 2.3)

decode("1d0LFaLM8fLm");         // { ms: 1786795496789, offset: 0, entropy: 2270577n, K: 4 }
offset("1d0LFaLM8fLm");         // 0 — the minter's date matched the UTC date
localDate("1d0LFaLM8fLm");      // "2026-08-15" — its calendar day where it was minted
localDateKey("1d0LFaLM8fLm");   // 20260815 — the same date as a bucket key
driftMs("1d0LFaLM8fLm");        // 0 while the timestamp is truthful (§ 7.3)
isPlid("1d0LFaLM8f-m");         // false — the only check that reads the whole string

dateOffset(Date.now(), "Asia/Tokyo");   // 1, 2 or 3: offset bits for an instant in a zone
MAX_MS;                                 // 70368744177663 — the field exhausts 4199-11-24
```

Widths are given as the profile name — the total text length, so `plid(12)` is a
PLID-12. The spec's `K` is `length − 8`; it survives as the name of the entropy
field in `decode`, but never as an argument.

| Export | Purpose |
|--------|---------|
| `plid(length?, offset?)` | Mint from the process-wide generator for a profile |
| `stamp(ms)` | The bare 8-character stamp, offset bits `0` — § 5.2 range bounds |
| `createGenerator(options)` | A generator owning its own `lastStamp` and counter |
| `decode` / `timestamp` / `offset` / `isPlid` | Read an ID of any width |
| `localDate(id)` / `localDateKey(id)` | The minter's calendar date (§ 2.3), or `null` |
| `driftMs(id, now?)` | How far an ID's timestamp is ahead of the clock |
| `dateOffset(ms, timeZone?)` | Offset bits 1, 2 or 3 for an instant in a zone |
| `ALPHABET`, `MAX_MS`, `DAY_MS`, `toDateOffset` | Constants and field helpers |
| `MIN_LENGTH`, `MAX_LENGTH`, `MAX_K` | § 2's width bounds: 8, 32 and 24 |

`stamp(ms)` and `plid(8)` both return 8 characters and are otherwise unrelated.
`stamp` is pure: it encodes a millisecond *you supply*, with offset bits `0`,
which is what makes it an exact range bound and what a minted ID must never
write. `plid(8)` mints for *now*, records the real date offset, and having no
entropy field borrows the next millisecond on every repeat within one.

`plid()` keeps one generator per width, never one counter shared across widths:
mixed widths still sort (§ 5.3), but a wide call's counter meeting a narrow
call's cap would force a spurious overflow borrow.

### 7.1 Generators

`createGenerator` takes the three ambient inputs as options — `now`, `offset`
and `seed` — so a pure core can inject its clock and zone rather than inherit
them, and tests can drive clock regression, entropy overflow and seeding
deterministically. The default `offset` reads the host zone, which is exactly
the kind of hidden input a pure core is meant not to have.

A fourth option, `since`, implements § 4's restart remedy:

```ts
createGenerator({ since: await store.maxId() });
```

`lastStamp` otherwise starts empty, so a process restarted after a clock
step-back emits stamps below IDs it emitted before. `since` raises the floor:
nothing the generator mints can sort at or below that ID.

It takes an ID, never a millisecond, because a millisecond names the *smallest*
stamp of that millisecond — offset bits `0` — so every ID minted there with bits
1–3 would still sort above it. At the generator's own width the counter carries
over and the next ID is `since`'s exact successor. From another width the
entropy fields are not comparable, and at an equal stamp a shorter ID sorts
below a longer one that extends it, so holding the stamp could mint below the
floor. The floor advances a whole millisecond instead, keeping `since`'s offset
bits.

The seed uses `crypto.getRandomValues` at whatever width the profile calls for
rather than a fixed 64 bits, so profiles from PLID-19 up seed correctly. Bytes
come from a 512-byte pool refilled in one call — a generator reseeds on every
new stamp, and a call per seed costs more than everything else in an ID put
together. Bytes are handed out in order and never reused.

### 7.2 Local dates

`localDate` reconstructs what § 2.3 recorded: the calendar date the *generator*
was on, which no timezone maths on the timestamp can recover afterwards.

```ts
localDate("1d0LFaLN");      // "2026-08-16"
localDateKey("1d0LFaLN");   // 20260816 — the same date, as a bucket key
localDate("1d0LFaLK");      // null — the minter encoded no local calendar
```

A string rather than a `Date`, deliberately: a `Date` is an instant, so
`new Date("2026-08-16").toString()` prints Aug 15 west of Greenwich — the exact
retroactive-timezone error the offset field exists to prevent. A string is
inert, sorts, and binds to a SQL `DATE` column as-is. `localDateKey` packs the
same date as `YYYYMMDD` for grouping and `dt=` partition keys: it sorts in date
order and allocates nothing, but it is a bucket key, not a number to compute
with — `20260831 + 1` is not a date.

You can read a local date off an ID but cannot index by one: IDs sharing a local
date span up to 48 hours of UTC and different offset bits, so filtering is a
range scan over the three candidate UTC days followed by a `localDate` check, or
a materialized column if it is a hot path.

### 7.3 Drift

§ 4 buys monotonicity by letting IDs run "briefly" ahead of real time. When that
assumption fails nothing in an ID says so: it is still well-formed, still
correctly ordered, and simply wrong about when it was made.

```ts
driftMs(id);            // 0 when the timestamp is truthful
driftMs(id, someMs);    // against a clock you supply

if (driftMs(plid()) > 250) log.warn("minting ahead of the clock");
```

Drift is a property of the ID, not generator state, so it reads on any PLID
including one from storage — `driftMs(row.id)` audits whatever process minted
it — and the clock is read at call time, so it decays back to `0` as real time
catches up.

Two causes want different remedies. A generator cannot borrow more milliseconds
than it has minted IDs, so drift much larger than your recent mint count is a
clock fault; seconds of drift is never a borrow at any reachable rate. A few
milliseconds under load is the entropy field overflowing, which means the
profile is too narrow for the burst.

### 7.4 Validation

`stamp` and every generator reject a millisecond outside `[0, 2^46)` with a
`RangeError` rather than overflowing into a 9th character, and a generator that
borrows past the field's end throws rather than wrapping. Every reader and
writer holds to § 2's 8-to-32-character bound.

Character validation is uneven, because the readers do different amounts of
work. `decode` and `isPlid` inspect the whole string. `timestamp`, `offset`,
`driftMs`, `localDate` and `localDateKey` read the 8-character stamp and stop,
so a stray character in the entropy field slips past them —
`timestamp("1d0LFaLM!!!!")` returns a millisecond rather than throwing. That is
the price of not walking a field they never use; `isPlid` is the check to run on
untrusted input.

---

## License

The `plid` package is **MIT** licensed, along with this document and the
conformance suite — see [LICENSE](LICENSE). The format itself is a description
rather than software: implement it in any language, under any license, with no
permission needed.
