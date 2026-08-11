-- A link on a song page is an icon now (#474): the host says where it goes and the `aria-label`
-- says it in words, so the name the form used to ask for is read by nothing. Dropped rather than
-- left in the stored JSON, where it would go on reaching the client and would make every save of
-- an untouched song look like a change to `songs.ts`'s comparison of before and after.
UPDATE `song`
SET `links` = (
  SELECT json_group_array(json_object('url', json_extract(`each`.`value`, '$.url')))
  FROM json_each(`song`.`links`) AS `each`
)
WHERE json_array_length(`links`) > 0;
