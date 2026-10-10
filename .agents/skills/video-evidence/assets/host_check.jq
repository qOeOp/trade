# Prints each URL a generic page declares that is not public HTTPS on port 443 by name (scheme://authority
# only); it must print nothing before any download.
[.webpage_url, .url, (.formats[]?.url), (.requested_formats[]?.url)] | .[] | strings
| (capture("^(?<s>[A-Za-z][A-Za-z0-9+.-]*):(//(?<a>[^/?#]*))?") // {s: ., a: ""}) as $u
| select(($u.s | ascii_downcase) != "https" or ($u.a | test("@"))
    or (($u.a | test(":[0-9]*$")) and ($u.a | test(":443$") | not))
    or ($u.a | sub(":[0-9]*$"; "") | test("^[0-9.]+$|^\\[|^localhost$|^[^.]+$|\\.(local|lan|internal|localhost|test|invalid|home\\.arpa)$"; "i")))
| "\($u.s)://\($u.a | sub("^[^@]*@"; "USERINFO@"))"
