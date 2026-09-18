# Food

The pantry: what the house usually has, where it lives and roughly how much
(#805). It replaces the spreadsheet's _Food inventory_ and _Spice inventory_
tabs, which were two tabs of the same shape — a thing, a place, a rough amount.
On top of it sit the hearts — what people want at one burn — and the shopping
list they fill (#806), and on top of that the ingredients of each sitting, which
are what turns that list into amounts (#807). Together they are what
[#804](https://github.com/fiddur/sage-burner/issues/804) calls food.

[← back to the README](../README.md)

## The pantry belongs to no burn

`pantry_item` has no `event_id`, like `song` and `allergy_item` and unlike almost
everything else here. A sack of oats does not stop existing between gatherings,
and the place it lives is a fact about the house rather than about a date. Per
burn it would mean typing the same forty things in every spring, and a count
taken in March would say nothing in July anyway — the count is a fact about
today, which is why it is a column on the row rather than a history.

What follows from that is the seed: a fresh install comes with a starter list —
two dozen breakfast, snack and household things — with ids fixed in the migration
so a new installation and an old one mean the same row by the same id. The
spreadsheet's own hundred and fifty rows come in through the import below. Places
are left empty. Where a thing lives is this house's answer and the software has
no business guessing it.

## Three answers, not a number

_Plenty_, _some_ and _out_. A number would be a promise nobody can keep: nobody
weighs the oats, and a pantry list that asks for a figure gets a figure somebody
made up or, more often, gets skipped. Taking inventory has to be one tap per row
while standing in the cellar holding a torch, which is what the three big buttons
are for.

_Some_ is the one that carries a rough amount, because "some" is the answer that
says nothing on its own — half a bucket and two kilos are both some, and the
buyer needs the difference. The amount is counted in the row's own `unit` (kg, l,
pkt, pcs, g), a free-text field rather than a vocabulary: this is a house's
shorthand, not a measuring system, and an admin who wants _knippe_ should have it.

`stock_amount` is refused anywhere but beside _some_, by the schema and by a
CHECK. The CHECK compares with `is` rather than `=`, because SQLite passes a
constraint whose expression comes out NULL, and `null = 'some'` is NULL — an
amount recorded against nothing counted would have slipped straight through the
obvious spelling.

Pressing the lit answer again clears the count, and clearing it also forgets who
counted and when. Nothing was counted then, and a row reading "counted by Ada
yesterday" above no answer is a worse record than no record.

## Counting is everybody's; the list is the admin's, for now

Any approved member may count anything: `requireApproved` on
`GET /api/pantry` and `PUT /api/pantry/:id/stock`, which is the shared-furniture
default the whole app runs on. Who counted and when are stamped from the session
and the clock, never from the body — the page cannot claim somebody else did it.

Deciding **what is on the list** is admin's, under `/api/admin/pantry`, and that
is the reversible half of the decision. A pantry row is not content the way a
song is; it is the vocabulary the hearts below and #804's later phases hang
ingredients and allergy tags off, and a list forty people can add to drifts into three
spellings of oatmeal within a season. If it turns out that adding a thing wants
to be everybody's, it is one prefix move away — the routes come out from under
`/api/admin/`, not exempted inside it.

## One name, one row

A unique index on `lower(trim(name))` — so "oatmeal", "Oatmeal" and " Oatmeal "
are one row, and a second one is refused with 409 rather than created quietly. A
duplicate here is not untidiness: two rows for the same sack means two counts
that disagree, and the hearts on one of them would buy against the other.

The index covers withdrawn rows too, which is deliberate and is why the 409's
message names both ways out: rename this one, or put back the one that was taken
off. Letting a withdrawn row's name go free would mean restoring it could clash
with something added since, and a restore that can fail is a restore people stop
trusting.

## Taking a thing off is soft

`withdrawn_at`, the songbook's rule. The list is what everybody counts against,
so a thing the house no longer keeps has to leave it — but an id the later phases
point at must not vanish, and somebody who took the wrong row off wants it back
rather than typed again. Members see only the living list; an admin sees the rest
under **Taken off** with a Restore beside each. Counting a withdrawn row is a 404:
it is not on the list, and the page does not offer it.

## Importing a sheet

`pnpm --filter sage-burner-backend pantry:import <file.tsv>` takes a
tab-separated file whose first line names `name`, `kind`, `unit` and `where`, and upserts by name,
case-insensitively: a thing already on the list has its kind, unit and place
updated, a new one is added, and **nothing touches the count**. A spreadsheet
knows what the house keeps; it knows nothing about what is in the cellar today.

The parsing is a pure function with its own tests, and it refuses rather than
guesses: a kind nobody named, a missing column or a line with no name stops the
import and names the line number. An empty unit cell becomes `pcs`, which is the
same default the form has. The import does not restore a withdrawn row either —
that is a decision about the list, and the file is not where it should be made.

The spreadsheet's four room columns become one `where` line, joined with a spaced
middot, **before** the import. That is a minute with a spreadsheet formula, against a
column-mapping vocabulary in the importer that every future sheet would disagree
with.

## Hearts: what you want there

A heart on a pantry row says "I want this at this burn", and the count is what
the buyer reads (#806). It is the cheapest thing the app can ask of a member —
one tap, no words — which is the point: the shopping used to be one person
guessing what forty people eat for breakfast.

`pantry_heart` is keyed on **`attendance`**, exactly as a bring-list hand is, and
for the same reason. Leaving the burn withdraws the heart, so the count never
outlives the person coming; and "fourteen want it" can be read as fourteen _of
the people who will be there_, which is the only reading that helps somebody
buying oats by the kilo. Keyed on the account it would have been a standing
preference, which nobody would ever revise.

Reading needs no attendance and writing does. Somebody who has not joined the
burn still sees what everyone wants — the page is worth looking at before you
decide to come — and pressing the heart meets the bring list's sentence about
joining first rather than a hidden control. That is #184's rule: a burn-scoped
route takes the event id, and the writes refuse a burn that has **ended** through
`openEventNow`, since wanting something at a gathering that is over asks nobody
for anything.

**No notification and no card.** #247's rule is about a role somebody else can
change; nothing here is done to anybody. A bell every time somebody hearts the
tortilla chips would be forty bells a week and would teach people to ignore the
channel.

The Meals page asks for **breakfast, snacks and around the house** — the three
kinds where wanting is the whole answer, because nobody cooks them. Staples and
spices are hearted from the Pantry page instead, where the burn selector in the
bar supplies the id; with no burn selected the heart is absent rather than inert.
Listing a hundred and fifty rows under the meal plan would have buried the plan.

## The shopping list

`/shopping?burn=…`, in ☰ after the Pantry. It is what somebody takes into the
shop, so the whole page is built around one thumb and a trolley: a real
checkbox per row, the name, how many want it, what the pantry says is in the
house, and where it lives.

**A tick is a row**, `pantry_purchase`, keyed on `(event, item)`. A column on
`pantry_item` would be wrong twice over — the item belongs to no burn, so the
next gathering would inherit last spring's ticks — and browser state would be
wrong once more: the list has to survive a phone dying between the dairy aisle
and the till, and two people shopping together have to see each other's ticks.
The row records who ticked it and when, and a second tick on the same thing
**keeps the first**, because the question it answers is "has somebody bought
this", not "who last pressed it".

**Nothing unhearted is listed.** The pantry is a catalogue of what the house
keeps, not a list of what to buy; without that rule the page would open on a
hundred and fifty rows with nothing to choose between them. What there is
**plenty** of is hearted but not bought, so it folds away behind a line saying
how many — hidden rather than absent, because a buyer standing in the shop may
well want to check.

The split is `shoppingSections` in `packages/shared/src/shopping.ts`, a pure
function with no Zod in it, the way `roster.ts` draws the line between a place
and the waiting list. The page renders what it returns and decides nothing
itself, which is what lets the ordering — most wanted first, ties by name — be a
test rather than a claim about a component. `shoppingText` is the same list as
plain lines for **Copy as text**, for the pasting into a chat that the app should
not try to prevent.

How **much** of each to buy comes from the sittings' ingredients, below.

## Ingredients

A sitting carries a list of what it takes, and one number — `meal.serves` — saying
how many people those amounts feed (#807). One number for the whole list rather
than one per line: a recipe is written for a number of eaters, and asking for it
again beside every lentil is the kind of form people abandon halfway. Whoever
writes it writes it for whatever number they cooked it for last time; the
shopping list does the arithmetic.

A line is **either** a pantry pick **or** a special buy, never both and never
neither — a CHECK on the table says so, not only the schema. A pick carries no
name and no unit of its own: the pantry row's are the true ones and are resolved
at read time, which is the data-model rule the whole app runs on. A thing written
here as `Lentils` while the pantry calls the sack `Lentils, red` would be a second
spelling that nothing adds up, and the count somebody took in the cellar would
buy against the wrong row.

The picker is therefore the nudge: typing filters the pantry and shows what is
there and where it lives, and the last row — **Use "…" as written** — is always
offered. That row is the escape hatch for the saffron nobody keeps a sack of, and
what it writes is listed apart on the shopping list rather than pretending to be
stock. Renaming a pick is refused: pick another instead.

An amount is optional, and absent means _to taste_ — salt does not scale and
nobody wants to be asked how many grams. Such a line asks the shopping list for
nothing while still appearing on the sitting, which is what a cook standing at the
stove wants to see.

`pantry_item_id` has **no `ON DELETE`**, deliberately. Taking a thing off the
pantry list is soft, so the row an ingredient points at is never deleted and the
reference cannot dangle; a withdrawn thing is refused as a _new_ pick, so the list
stops offering it without rewriting what is already planned. A sitting that still
asks for one goes on saying so, and the shopping list carries it among the special
buys rather than dropping it: the house no longer stocks the thing, which is
exactly what a special buy is, and a meal quietly losing an ingredient because an
admin tidied the pantry is the worse answer.

Writing, changing or taking off a line adds **one coalescing `edited` entry** to
the sitting's existing card — the same entry the food idea makes. The digest then
says the plan moved without a line per lentil, and nobody is notified: an
ingredient is not something done to anybody. A **tick** in the shop writes no
entry at all; buying is not a change to the plan.

## How the list is worked out

`shoppingSections` in `packages/shared/src/shopping.ts` is the whole of it — a
pure function with no Zod in it, the way `roster.ts` draws the line between a
place and the waiting list. The page renders what it returns and decides nothing,
which is what lets every rule below be a test rather than a claim about a
component.

**The headcount is per day.** People arrive on the Friday and leave on the Sunday,
so a Friday dinner and a Saturday dinner are not the same number of mouths.
`headcountOn` counts the attendances that have a place (`withPlaces`, the same
ordering the roster page shows) and whose stay covers that date — `arrival_date`
null or on or before it, `departure_date` null or on or after it. The comparison
is between plain `YYYY-MM-DD` strings, so no timezone can move anybody a day
either way; a stay with no dates on it is the whole burn.

**"Buying for [n]" is where the margin goes.** Left empty, each sitting counts the
people there that day. A number replaces that for every sitting at once — for the
guests who never filled anything in, for the second helpings, for the buyer who
would rather come home with too much. It is not stored: it is a knob on the page
for the hour somebody is in the shop, not a decision about the burn.

**Then the arithmetic.** `scaled` takes an amount from what it feeds to who is
there, the sum over sittings is what the burn `need`s, what the pantry says is in
the house is taken off it — _some_ counts as its rough amount, _plenty_ as enough,
_out_ and never counted as nothing — and what is left is rounded **up** by
`roundUp`: to a tenth for `kg` and `l`, to a whole for everything else. Rounding
up, because coming home short is a meal that does not happen and coming home long
is a sack in the cellar; to the whole for pieces and packets, because shops do not
sell 2.4 packets. Rounding happens once, on the sum: four onions written for ten,
at three sittings with eleven people there, is fourteen to buy rather than the
fifteen that rounding each sitting first would ask for. The per-sitting figures
beside the row are rounded for reading and are not what is added up.

A thing the house has enough of folds away under the same line as the _plenty_
ones above, because a buyer in the shop may still want to check. A hearted
thing nobody cooks with keeps exactly the row it had: no amount is invented for
it, since a heart says "I want this here" and nothing about how much.

**Special buys gather by name and unit, lowercased.** Two cooks writing
`Coriander, fresh` and `coriander, fresh` are one line on the list — they are one
trip down one aisle — while the same word in two units stays two rows, because
`1 kg` and `1 bunch` of the same herb are not one purchase. Ticking such a row
ticks every line in the group, and the row only reads as bought once all of them
are: half a group bought is a thing still to buy.

Amounts are **stored nowhere** but on the sitting. There is no per-burn "we need
14 kg of oats" row to keep in step with the plan, so moving a sitting, changing
who is coming or correcting `serves` is enough, and the list cannot go stale
against what the sittings actually say.

## What this deliberately does not have

No thread, no notification, no feed card on a pantry row. A pantry row is
furniture: nobody wants a bell because the flour is running low, and the
conversation belongs where the flour is needed — on the sitting's card, which is
where an ingredient edit lands. Allergy tags on a pantry item, and the warning on
a sitting whose ingredients somebody there cannot eat, are phase 4 of
[#804](https://github.com/fiddur/sage-burner/issues/804) and are not here.
