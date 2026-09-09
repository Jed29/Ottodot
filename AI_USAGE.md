# AI Usage

## Which AI tools I used
Claude Code and regular Claude chat.

## What I used AI for
Honestly, quite a lot — the database schema, the booking service logic
(including the transaction/locking part), the seed data for testing, and the
test suite. The docs (README, this file) were also AI-drafted first, then I
read through and adjusted them.

What I did myself was mostly deciding what the requirements actually needed
to be (what has to be prevented, which edge cases are non-negotiable),
reviewing what came back, running it against a real database to make sure it
actually worked, and fixing it where it didn't.

## Where AI helped the most
The last-seat race condition part — two people fighting for the same last
spot. I understood the concept of what needed to happen, but writing an
actually-safe solution for it in Postgres from scratch would've taken me a
while to think through. AI suggested using `SELECT ... FOR UPDATE` inside a
transaction — so if two payment requests come in at the same time for the
same class, one of them just waits its turn instead of both racing through.
What really helped was it also wrote a test that actually fires two payments
at the same seat simultaneously, and I ran it myself to confirm only one goes
through. So it wasn't just "trust me it works" — there was proof when I
actually ran it.

## Where I disagreed with or corrected the AI's output
When I ran the full test suite, one test failed — the duplicate booking
check. Turned out the order of checks was wrong: it checked "is the class
full" before checking "does this kid already have a booking here." So if the
class happened to already be full, someone trying to double-book would get a
"class full" error instead of the correct "you already booked this" error. I
only caught this because the test failed, not because I spotted it reading
the code. I had it fix the order and re-ran everything until it actually
passed clean.

## What I'd change about my AI workflow next time
Probably ask for the tests to be written first, before the actual function.
That way a bug like the one above would show up right away instead of only
surfacing at the end when running the full suite.

## How I verified this actually works
- Seeded a real Postgres database (not mocked) and ran the full automated
  test suite, including the one that simulates two people paying for the
  last seat at the same time.
- Started the server for real and manually hit each endpoint with curl.
- Read through the transaction/locking code myself so I actually understand
  why it prevents the race condition, instead of just taking AI's word for it.