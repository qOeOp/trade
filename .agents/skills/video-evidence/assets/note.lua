-- pandoc --lua-filter for note.md. Keeps pandoc --embed-resources from embedding local files or fetching
-- URLs named by source text copied into a note: images stay only when they are bundle frames or crops;
-- links only https or in-page; raw HTML and other raw formats are dropped; every element loses its
-- attributes (data-src, poster and similar are embedded by pandoc); metadata keeps only the title.
local function bundle_png(src)
  return not src:find("%.%.") and (src:match("^frames/[%w_-][%w_.-]*/[%w_-][%w_.-]*%.png$")
    or src:match("^crops/[%w_-][%w_.-]*%.png$")) ~= nil
end
local function bare(el) el.attributes = {} return el end
function Image(el)
  if bundle_png(el.src) then return bare(el) end
  return pandoc.Str("[image removed]")
end
function Link(el)
  if el.target:match("^https://") or el.target:match("^#") then return bare(el) end
  return el.content
end
Span, Div, Header, Code, CodeBlock, Table, Figure = bare, bare, bare, bare, bare, bare, bare
function RawInline() return {} end
function RawBlock() return {} end
function Meta(m) return pandoc.Meta({title = m.title}) end
