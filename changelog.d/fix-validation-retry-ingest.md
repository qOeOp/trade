- A passed validation run is refused (`RETRY_NOT_ALLOWED`) when a retry of its registration was registered after its
  capture and before its run was stored. Before, both attempts passed and the report read the retry instead (#3580).
