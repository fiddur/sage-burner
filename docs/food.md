# Food

The pantry: what the house usually has, where it lives and roughly how much
(#805). It replaces the spreadsheet's _Food inventory_ and _Spice inventory_
tabs, which were two tabs of the same shape — a thing, a place, a rough amount.
On top of it sit the hearts — what people want at one burn — and the shopping
list they fill (#806), and on top of that the ingredients of each sitting, which
are what turns that list into amounts (#807) and what the allergy warning reads
(#808), and beside the count a flag anybody can raise to put a thing on the list
(#813) and the rooms it is kept in (#814), and the promotion that turns something cooks keep
writing by hand into a row of the pantry (#815). Together they are what
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
spreadsheet's own hundred and fifty rows come in through the import below. The
rooms are seeded — Kitchen, Hallway, Cellar, Party kitchen, the spreadsheet's own
columns — and no thing is put in any of them. Which box in which room a sack lives
in is this house's answer and the software has no business guessing it.

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

## The list is an overview; counting is a mode

The first real import put a hundred and ninety rows on the page, and four 44px answers, a
**Need more** and a pen on every one of them made it a wall nobody could read down (#819).
The buttons are only wanted while somebody is actually counting, which is a few minutes
a season; the rest of the time the question is "what does the house have, and where".

So **Inventory management** is a chip beside the kind and room chips, off by default, plain
component state — no storage, because the answer to "am I counting right now" is never yes
tomorrow. Everybody approved sees it, since counting is everybody's; the pen and the bin
inside it stay admin's as they were.

With it off a row is the name, the kind, what it contains, the heart when a burn is chosen,
and — muted, at the end of the same line above 45rem and on a line of its own below it —
where it lives followed by the count **in words**: `plenty`, `some`, `~2 kg`, `out`, and
`need more` when it is flagged. That is the same state the buttons carry, said rather than
offered, so the page still answers at a glance what a walk through the cellar would.

The **room walk** keeps its box tag leading the row in both modes. The box is what the eye
follows down a shelf and it is not one of the counting controls; the walk is how somebody
finds a thing, not only how they count it.

## A note on a thing, for whoever is writing an amount

A thing counted in one unit is often cooked in another: black beans are kept in kg and the
cook wants `Dry weight. 0.09 kg becomes ca 2.5 dl/230 g`. A second unit on the row would be
the wrong answer — the pantry row's unit is the true one, the one the count and the shopping
list are both in, and a second one would mean deciding which of two figures a line's amount
is in. A sentence decides nothing and is the cheapest thing that stops a cook typing dl into
a kg box.

So `pantry_item.note` is plain text, not markdown, bounded by `MAX_PANTRY_NOTE`, written in
the add form and the pen and imported from an optional `note` column in the TSV. On a row it
is an info icon after the kind, a `<details>` whose summary is the icon — a bubble that opens
on a click and needs no JS — and the Inventory toggle does not touch it: a note is part of
the overview, not of counting.

It is shown **where the amount is typed**, which is the whole point: on a sitting, the note
of the pantry thing under the cursor in the add box appears before the thing is even taken,
stays beside the amount box once it is, and rides behind the same icon on a line already
written. The shopping list gets none of it — the buyer reads the row's unit and the line's
amount, and the note is for the person who wrote that amount.

## Places: a room, and a box in it

The spreadsheet had a column per room — Kitchen, Hallway, Cellar, Party kitchen —
and a box or a shelf in each cell: "Bucket", "Left white box", "C", "R2, R3". One
free-text line loses the room, and **the room is what inventory is done by**: you
walk the cellar with a torch and go box by box, and a page that cannot show you one
room at a time is a page you use standing in the wrong place.

So the rooms are a **vocabulary** — `pantry_place`, ordered, admin-edited, the shape
`allergy_item` has — and a thing is in a room through `pantry_item_place`, which
carries the `spot`. Free text would have been three spellings of "cellar" within a
season, and nothing to chip the page by; a fixed enum would have been this house's
four rooms compiled into everybody's installation. The spot beside it stays free
text for the same reason the unit does: "R2, R3" and "left white box" are a house's
shorthand, not a coordinate system, and it **may be empty** — the thing is in this
room, at no particular box, which is a real answer and not a missing one.

The `where` line the pantry had before this is **dropped**, which SQLite can only do
by rebuilding the table, and what any row said is carried into a spot in a fifth
room, **"Somewhere"**, seeded only where such a row exists. A free-text line cannot
be sorted into rooms by the software, and losing it would be losing the only record
of where the thing is; an empty extra room in every installation that never used the
column would be furniture nobody asked for.

**Stock stays per thing, not per place.** A count is about the sack, and "some,
about 2 kg" summed across a bucket and a shelf is what the buyer wants; asking for a
count per room would be asking the same question four times and getting three
guesses. The same goes for the need-more flag and the hearts: they are about the
thing.

**Removing a room that still holds something is refused**, with a 409 and "rename it
instead: _n_ things are in it". `pantry_item_place.place_id` has no `ON DELETE`, so
SQLite refuses it and `pantry-places.ts` turns the refusal into the 409 — the
`account_allergy` rule rather than the `pantry_item_allergy` one. The difference is
what the row means: a tag on a pantry thing is an admin's note that can be recreated
from the thing itself, while a spot is where the sack actually is, and dropping a
room would quietly lose fifty of those. Renaming is the answer, and everything in
the room follows it.

**Placing a thing is everybody's**, `PUT` and `DELETE /api/pantry/:id/places/:placeId`
under `requireApproved`, beside counting rather than beside the catalogue. Somebody
moving a bucket from the hallway to the cellar is reporting a fact about the house,
exactly as counting is; waiting for an admin would mean the page goes stale the first
afternoon somebody tidies. What is on the list stays admin's, so the add and the pen
take the rooms too and an unknown room there is a 400 rather than a dropped id.

**The walk is sorted by spot, naturally**, `bySpot` in `packages/shared/src/pantry.ts`:
"B" before "C", "R2" before "R10", and **the boxless last** because they are the ones
the walk cannot find. A plain string sort would put R10 between R1 and R2, which is
the one thing a person holding a torch will not forgive. It is a pure function beside
`whereSaid`, which renders "Cellar C · Hallway bucket" for the list, the sitting's
panel, the picker and the shopping list — one sentence in one place rather than four
that drift.

**The chosen room lives in the URL** (`?place=`), so a reload in the cellar keeps the
cellar and the chip row is shareable, which is #184's habit applied to a page that has
no burn in it.

**"Put something here"** is the other half of the walk: you find a bucket of lentils
on the floor, and the thing you want is not "edit the lentils" but "put this here".
The box filters the whole live pantry by name, lists what is **not** in this room yet
with where it is now, and asks for the box. Its last row offers an admin the add form
with the name and the room filled in — a thing that is in no catalogue is a thing to
add, and making somebody leave the cellar to do it is how the spreadsheet lost rows.
A member sees the sentence about asking an admin instead, since adding stays admin's.

The one deviation from a plain "a blank box means it is not there": the admin's add
and pen carry **a tick box per room beside the spot**, ticked by typing a box. A blank
input has to mean something, and "in the room, at no particular box" and "not in the
room" are both real answers — the tick says which, and the ✕ in the walk says the other
one in one press.

## Need more: a request, not a fourth answer

_Out_ is a fact about the shelf and **Need more** is a request, and the two come
apart in both directions. Saffron can be out with nobody needing any until
somebody cooks with it; there can be four kilos of rice in the cellar and the
buyer should still bring a sack, because forty people eat through four kilos in a
weekend. A fourth button on the count would have forced one answer to two
questions, and whichever one it recorded the other would be lost.

So `need_more_at` is its own column — flagged is "not null" — with `need_more_by`
beside it saying who asked. There is **no CHECK tying the two together**: the
account may go while the request stays, exactly as `bought_by` / `bought_at` do on
a purchase, and the importer writes one with no `by` at all. That is why the page
says "Need more · when" with nobody named rather than the "somebody who has left"
the count uses — here a missing name is the ordinary case, not a departure.

**The flag outranks the count on the shopping list.** A flagged thing is listed
under _From the pantry_ whether or not anybody hearted it, and a flagged _plenty_
thing stays on the list rather than folding away with the rest: somebody looked at
the shelf **after** the count was taken, and a page that quietly hid what they
asked for would teach them to stop asking. It brings no amount with it — a
request says "bring some", not how much, the same as a heart — so a sitting is
still the only thing that can put a figure beside it.

**Ticking it bought clears it, in the same request.** Buying it is what was asked
for, and the next count starts clean. Unticking does not bring it back: the tick
was a mistake, the request had already been answered, and somebody standing in
the cellar can raise it again in one press. Like a heart, it tells nobody and
writes no card — #247 is about a role somebody else can change, and nothing here
is done to anybody.

The flag is **global, like the count**: it is the house that is low on rice, not
one burn, so the routes are `PUT` and `DELETE /api/pantry/:id/need-more` under
`requireApproved` and take no event id. Asking for something already asked for
keeps the first asker, because the question it answers is "has somebody asked for
this", not "who last pressed it" — the purchase tick's rule. Asking for a
withdrawn row is a 404, as counting one is: it is not on the list. Taking the ask
back answers 204 whatever was there, withdrawn or never flagged, since a clear
that can fail is one the page would have to reason about.

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
tab-separated file whose first line names `name`, `kind` and `unit`, then **one
column per room**, and may carry `need more` — the spreadsheet's own column — and
`note`. It upserts by name, case-insensitively: a thing already on the list has its
kind, unit and spots updated, a new one is added, and **nothing touches the count**.
A spreadsheet knows what the house keeps; it knows nothing about what is in the
cellar today.

The parsing is a pure function with its own tests, and it refuses rather than
guesses: a kind nobody named, a missing column or a line with no name stops the
import and names the line number. An empty unit cell becomes `pcs`, which is the
same default the form has. The import does not restore a withdrawn row either —
that is a decision about the list, and the file is not where it should be made.

A non-empty cell under `need more` raises the flag, with nobody named; an empty
one leaves whatever is there alone, and a row already flagged keeps the name and
the moment it has. Re-importing the sheet must not overwrite "asked by Cleo this
morning" with "asked by nobody", and a column the sheet left blank is not the
same statement as somebody pressing the button again.

`note` follows the same rule for the same reason: a cell with something in it is
written onto the row, an empty one leaves the note that is there. A sheet exported
before anybody wrote a note carries a column of blanks, and blanking every note in
the pantry is not what re-importing it means.

**A room column is matched to the vocabulary by name, ignoring case, and a column
naming no room refuses the whole file and says which column it was.** Guessing would
be worse than refusing: the cost of a typo is a room nobody can find again, and the
fix — renaming the column, or adding the room under ⚙️ → Pantry places — takes
seconds. A cell is the box; an empty cell means the thing is not in that room, and
the spots for the rooms the header names are **replaced** for the things in the file
while a room the header leaves out is untouched. So the spreadsheet's two tabs import
as they are, once the spice tab's _Jar_ and _Refills kitchen_ columns are renamed to
room names.

Because the columns are matched against rows in the database, the file is read
**after** the migrations have run and the vocabulary has been read, not before: the
CLI opens the database first and the parsing takes the rooms as an argument, which is
what keeps `readPantryTsv` a pure function with its own tests.

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

**Nothing gets on the list by sitting in the pantry.** A row is there because
somebody hearted it, a sitting cooks with it, the pantry says more is needed, or it
was bought for this burn already — a tick that answered a request must not make the
row vanish from under the buyer's thumb;
without that rule the page would open on a hundred and fifty rows with nothing to
choose between them. What there is **plenty** of and nobody has asked for folds
away behind a line saying how many — hidden rather than absent, because a buyer
standing in the shop may well want to check.

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

## Promoting a special buy

The escape hatch works, which is what makes this necessary: the third time somebody
writes "Saffron, 1 g sachets" because the pantry has no row for it, it is a thing the
house keeps — and three sittings still carry it as free text that no count in the
cellar is ever taken against. **Written on sittings, not in the pantry**, at the foot
of the Pantry page, is that list: the special buys on burns still to come, gathered by
`specialKey` — the shopping list's own rule, exported rather than written out a second
time, so the page and the list cannot disagree about what is one purchase — with the
count of sittings, one of them named, and **Promote** beside each.

**Promote fills the add form rather than adding the row.** A pantry thing needs a kind
and the rooms it lives in, and no ingredient line can say either; the admin is the one
who knows. Saving is then the ordinary add followed by the adoption, which is why the
outcome is a sentence about how many lines followed rather than a silent refresh.

**Promotion takes the lines whatever the admin renamed**, including the unit (#819).
The match runs on the remembered key — the name and unit the lines were written under —
so renaming `Salsa` to `Salsa, chunky` on the way in has always worked; the unit used to
be the one field that blocked, and a promotion that added the row and moved nothing was
the outcome nobody pressed Promote for.

What the unit still cannot do is change silently. A pick carries no unit of its own —
the pantry row's is the true one — so a line written in `jars` joining a thing counted
in `jars (300g)` would quietly change what the shopping list adds up. **The admin says
what each line becomes**, in the `Adjust the amounts` step the form grows in place of
**Add it** once the unit differs: one row per line, the sitting named, the old amount as
it was written, and a box in the new unit prefilled with the old figure. Only the person
promoting knows what a jar of salsa is in `jars (300g)`, so the form asks rather than
converts.

That is why the read carries `lines` and the adoption takes `amounts`, keyed by line id.
An `amounts` key naming a line the adoption is not converting is a 400 rather than a
silent skip: it means the page and the server disagree about what is being promoted, and
the quiet version of that is a wrong figure in the shop. A line the step leaves alone
keeps the amount it already had.

A line written under **another key** — the same name in another unit — is a different
special buy, still listed and still promotable under its own key. The key bounds the
promotion; the pantry thing's own unit no longer does.

What the line already carries is kept — the amount, and a tick somebody made in the
shop. Only the name and the unit go, because the pantry row now supplies them.

**A burn that has ended is left as written.** Adoption rewrites what a sitting asks
for, and a sitting that has happened is a record of what was cooked rather than a plan
anybody can still act on; the reading half skips those burns for the same reason —
they are not what this is deciding about. That is `openEvent`'s rule, not
`activeEvent`'s: every burn still to come is fair game, since a grid is laid out months
ahead.

**Both halves are admin's**, `GET /api/admin/special-buys` and
`POST /api/admin/pantry/:id/adopt`, because deciding what is on the list is admin's and
a promotion is an add. The read shows nothing a member cannot already see on the Meals
page, and it sits under the prefix rather than beside it because an exception there is
the thing the prefix exists to make impossible.

Each sitting it touches gets the same coalescing `edited` entry an ingredient edit
makes, and nobody is notified. What the sitting needs has not changed; what it points
at has.

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

## Who cannot eat it

This is the part [#25](https://github.com/fiddur/sage-burner/issues/25) was really
about, and the part a spreadsheet cannot do: a meal lead writing cashews into
Saturday's dinner has no way of knowing that two of the thirty-four people there
that evening cannot eat nuts. `pantry_item_allergy` is the join that makes it
possible — a pantry thing tagged with items from the **same vocabulary members
tick about themselves**, so the two sides can be intersected at all. A second
vocabulary for ingredients would have been a translation table nobody maintains.

**The tag is on the pantry row, not on the ingredient line.** A cashew contains
nuts wherever it is cooked, so tagging it once is one answer for every sitting
that ever picks it; tagging the line would be the same claim written out per
sitting, and the third cook would forget. It is also what lets the shopping list
mark the row, which has no sitting behind it at all. This is the shape the whole
data model follows: reference the thing, resolve its facts at read time.

**Cascading, unlike `account_allergy`.** That table has no `ON DELETE` on its
`allergy_item` reference, so SQLite refuses to retire a vocabulary item somebody
has ticked and `allergies.ts` turns the refusal into a 409 — deleting it would
destroy somebody's statement about themselves. A tag on a pantry row is nobody's
statement about themselves; it is an admin's note about a sack of nuts, and
retiring "Nuts" from the vocabulary should take the notes with it rather than
being blocked by them. Tagging is admin's, under `/api/admin/pantry`, exactly as
deciding what is on the list is; an unknown allergy item is a 400 rather than a
silently dropped id, and the set sent **replaces** what was there, so unticking
is a save rather than a second route.

**The derivation is a pure function**, `cannotEat(entries, date, allergyIds)` in
`packages/shared/src/shopping.ts`, beside `headcountOn` and following the same
stay rule: somebody with a place whose `arrival_date`/`departure_date` cover that
plain `YYYY-MM-DD`. So "2 of the 34 here on Saturday" counts the two against the
same thirty-four, rather than against everybody who ever joined the burn. The
waiting list is out of both, through the `waiting` the roster read already
carries. A `null` date means the whole burn and nobody's stay is consulted —
that is what the shopping list wants, since a row there is not about one evening.

**The source is the roster read** members already have,
`GET /api/events/:eventId/members` (#159), which carries each entry's ticked
allergy items — as ids beside the labels the Members page shows, since a tag is
an id and a label can be renamed. Nothing new is exposed: the names are on the Members page and the
ticks are what the whole allergy vocabulary exists to publish to whoever cooks.
It also means the warning is a page-side intersection of two reads the page makes
anyway, rather than a fifth route to keep in step.

**Free text is counted, never matched.** `allergies_notes` is a sentence a person
wrote — "red lentils make me ill", "I react to something in cheap curry powder" —
and no substring search over it is right often enough to be trusted. Matching
"nuts" against "no nuts, but nutmeg is fine" is the failure that would teach a
cook to ignore the box. So the line below says only how many people there wrote
something, and links to the roster where the sentences are, and a cook reads them.
Somebody already named above is not counted again; "k more" means more.

## What this deliberately does not have

No thread, no notification, no feed card on a pantry row. A pantry row is
furniture: nobody wants a bell because the flour is running low, and the
conversation belongs where the flour is needed — on the sitting's card, which is
where an ingredient edit lands. A tag is the same: it is an admin correcting the
catalogue, not something done to anybody, and the warning it raises is read where
the cooking is planned rather than pushed at everybody who might be affected.
