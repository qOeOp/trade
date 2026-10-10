-- pandoc --lua-filter for note.md: source text copied into a note can never make pandoc --embed-resources
-- read a local file or fetch a URL. Images stay only when they are bundle frames or crops; links only https
-- or in-page; raw HTML and other raw formats are dropped; metadata keeps only the title, so no css,
-- header-includes or other template variable reaches the HTML template.
local function bundle_png(src)
  return not src:find("%.%.") and (src:match("^frames/[%w_-][%w_.-]*/[%w_-][%w_.-]*%.png$")
    or src:match("^crops/[%w_-][%w_.-]*%.png$")) ~= nil
end
function Image(el)
  if bundle_png(el.src) then return el end
  return pandoc.Str("[image removed]")
end
function Link(el)
  if el.target:match("^https://") or el.target:match("^#") then return el end
  return el.content
end
function RawInline() return {} end
function RawBlock() return {} end
function Meta(m) return pandoc.Meta({title = m.title}) end
