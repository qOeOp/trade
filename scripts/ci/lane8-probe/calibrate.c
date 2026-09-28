/* LANE8 PROBE, NOT FOR MERGE. Uses a known stack depth on a 16 MiB thread, measured from its own
   stack pointer addresses, and exits right after join: the runner must read that depth back. */
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uintptr_t top, deepest;

static int recurse(long bytes) {
  volatile char buf[4096];
  memset((char *)buf, (int)bytes, sizeof buf);
  uintptr_t here = (uintptr_t)&buf[0];
  if (here < deepest) deepest = here;
  if ((long)(top - here) >= bytes) return buf[7];
  return recurse(bytes) + buf[11];
}

static void *run(void *arg) {
  volatile char marker;
  top = deepest = (uintptr_t)&marker;
  recurse(*(long *)arg);
  return NULL;
}

int main(int argc, char **argv) {
  long bytes = atol(argv[1]) * 1024;
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 16777216);
  pthread_t thread;
  pthread_create(&thread, &attr, run, &bytes);
  pthread_join(thread, NULL);
  printf("LANE8-CALIBRATE target %ld KiB, used %lu KiB by stack pointer\n", bytes / 1024,
         (unsigned long)((top - deepest) / 1024));
  return 0;
}
