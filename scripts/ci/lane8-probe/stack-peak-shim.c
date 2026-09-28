/* LANE8 PROBE, NOT FOR MERGE. LD_PRELOAD shim: wraps pthread_create so that, when a thread's start
   routine returns and before glibc releases the used part of its stack at exit, it counts the
   stack's resident pages with mincore(). Stack pages are faulted in only when first touched and the
   stack probe touches every page of a large frame, so that count is the thread's peak depth. Only
   stacks of at least 3 MiB are reported: the 16 MiB RUST_MIN_STACK threads and the
   Research setup's own 4 MiB thread (rd_owner_api_main authored_design_research). */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <unistd.h>

struct start {
  void *(*routine)(void *);
  void *arg;
};

static void record(void) {
  pthread_attr_t attr;
  void *base;
  size_t size;
  if (pthread_getattr_np(pthread_self(), &attr) != 0) return;
  pthread_attr_getstack(&attr, &base, &size);
  pthread_attr_destroy(&attr);
  if (size < 3u * 1024 * 1024) return;
  size_t page = (size_t)sysconf(_SC_PAGESIZE), pages = size / page, resident = 0;
  unsigned char *vector = malloc(pages);
  if (vector == NULL || mincore(base, size, vector) != 0) {
    free(vector);
    return;
  }
  for (size_t i = 0; i < pages; i++) resident += vector[i] & 1;
  free(vector);
  const char *log = getenv("LANE8_STACK_LOG");
  FILE *out = fopen(log ? log : "/tmp/lane8-stack.tsv", "a");
  if (out == NULL) return;
  char name[64] = "?";
  pthread_getname_np(pthread_self(), name, sizeof name);
  const char *entry = getenv("LANE8_ENTRY");
  fprintf(out, "%s\t%s\t%zu\t%zu\n", entry ? entry : "?", name, resident * page / 1024, size / 1024);
  fclose(out);
}

/* Only the test binary carries the shim: what it launches (Chrome, node, psql) does not inherit it. */
__attribute__((constructor)) static void forget_preload(void) { unsetenv("LD_PRELOAD"); }

static void *trampoline(void *raw) {
  struct start start = *(struct start *)raw;
  free(raw);
  void *result = start.routine(start.arg);
  record();
  return result;
}

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*routine)(void *), void *arg) {
  static int (*real)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
  if (real == NULL) real = dlsym(RTLD_NEXT, "pthread_create");
  struct start *start = malloc(sizeof *start);
  if (start == NULL) return real(thread, attr, routine, arg);
  start->routine = routine;
  start->arg = arg;
  return real(thread, attr, trampoline, start);
}
