# Food

The pantry: what the house usually has, where it lives and roughly how much
(#805). It replaces the spreadsheet's _Food inventory_ and _Spice inventory_
tabs, which were two tabs of the same shape — a thing, a place, a rough amount —
and the first half of what [#804](https://github.com/fiddur/sage-burner/issues/804)
calls food.

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
song is; it is the vocabulary the later phases of #804 hang hearts, ingredients
and allergy tags off, and a list forty people can add to drifts into three
spellings of oatmeal within a season. If it turns out that adding a thing wants
to be everybody's, it is one prefix move away — the routes come out from under
`/api/admin/`, not exempted inside it.

## One name, one row

A unique index on `lower(trim(name))` — so "oatmeal", "Oatmeal" and " Oatmeal "
are one row, and a second one is refused with 409 rather than created quietly. A
duplicate here is not untidiness: two rows for the same sack means two counts
that disagree, and the shopping list in phase 2 would buy against the wrong one.

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

## What this deliberately does not have

No thread, no notification, no feed card. A pantry row is furniture: nobody wants
a bell because the flour is running low, and #804's later phases put the
conversation where it belongs — on the sitting that needs the flour. Hearts, the
shopping list, ingredients per sitting and allergy tags are phases 2 to 4 and are
not here.
