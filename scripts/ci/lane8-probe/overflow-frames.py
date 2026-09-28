# LANE8 PROBE, NOT FOR MERGE. gdb script: run the test, stop at the stack-overflow SIGSEGV, and print
# every frame of the faulting thread with the stack it uses (the sp difference to its caller), then
# the largest frames and the functions that recur. Loaded with gdb -batch -x.
import gdb


gdb.execute("set pagination off")
gdb.execute("set print demangle on")
gdb.execute("set print asm-demangle on")
gdb.execute("handle SIGPIPE nostop noprint pass")
gdb.execute("handle SIGUSR1 nostop noprint pass")
gdb.execute("handle SIGSEGV stop print nopass")
gdb.execute("run")

frames = []
frame = gdb.newest_frame()
while frame is not None:
    try:
        sp = int(frame.read_register("sp"))
    except gdb.error:
        break
    name = frame.name() or "??"
    sal = frame.find_sal()
    where = f"{sal.symtab.filename}:{sal.line}" if sal and sal.symtab else ""
    frames.append((sp, name, where))
    frame = frame.older()

if not frames:
    print("LANE8-GDB no frames: the process did not stop on a fault")
else:
    top = frames[0][0]
    print(
        f"LANE8-GDB faulting thread: {len(frames)} frames, {(frames[-1][0] - top) // 1024} KiB between the innermost and outermost sp",
    )
    rows = []
    for i, (sp, name, where) in enumerate(frames):
        size = frames[i + 1][0] - sp if i + 1 < len(frames) else 0
        rows.append((size, i, name, where, sp - top))
    for size, i, name, where, depth in rows:
        print(
            f"LANE8-GDB frame {i:4d} size {size:8d} depth {depth // 1024:5d} KiB  {name[:150]}  {where}",
        )
    print("LANE8-GDB largest frames:")
    for size, i, name, _where, _depth in sorted(rows, reverse=True)[:25]:
        print(f"LANE8-GDB   {size:8d}  #{i:<4d} {name[:150]}")
    counts = {}
    for _, _, name, _, _ in rows:
        counts[name] = counts.get(name, 0) + 1
    print("LANE8-GDB functions that appear more than once on the stack:")
    for name, count in sorted(counts.items(), key=lambda kv: -kv[1])[:15]:
        if count > 1:
            print(f"LANE8-GDB   x{count:<4d} {name[:150]}")
gdb.execute("kill")
