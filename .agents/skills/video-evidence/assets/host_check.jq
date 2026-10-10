# For the generic extractors, prints each URL the page declares that is not HTTPS on port 443 to a public
# name (scheme://authority only); it must print nothing before any download. Tabs, newlines and a trailing
# dot are removed first; a host whose last label does not start with a letter is an IP literal (0x7f.1,
# 127.1). The checker's public_https_host repeats this rule on the kept identity and receipt.
select(.extractor_key | IN("Generic", "HTML5MediaEmbed"))
| [.webpage_url, .url, (.formats[]?.url), (.requested_formats[]?.url)] | .[] | strings | gsub("[\t\r\n]"; "")
| (capture("^(?<s>[A-Za-z][A-Za-z0-9+.-]*):(//(?<a>[^/?#]*))?") // {s: ., a: ""}) as $u
| ($u.a | sub("^.*@"; "") | sub(":[0-9]*$"; "") | sub("\\.$"; "") | ascii_downcase) as $host
| select(($u.s | ascii_downcase) != "https" or ($u.a | test("@"))
    or (($u.a | test(":[0-9]*$")) and ($u.a | test(":443$") | not))
    or ($host | test("^[a-z0-9-]+(\\.[a-z0-9-]+)*\\.[a-z][a-z0-9-]*$") | not)
    or ($host | test("(^|\\.)(localhost|local|lan|internal|test|invalid|home\\.arpa)$")))
| "\($u.s)://\($u.a | sub("^[^@]*@"; "USERINFO@"))"
