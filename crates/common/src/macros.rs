//! Convenience macros for implementing actor boilerplate.

/// Wires an actor type's core field into the native runtime contract.
///
/// The struct must contain a field that provides a
/// [`DataActorCore`](crate::actor::DataActorCore) reference, either directly or
/// by deref coercion through an intermediate core type (e.g. `ExecutionAlgorithmCore`).
/// By default the macro expects the field to be named `core`; pass a second argument
/// to use a different name.
///
/// The generated native access implementation is runtime wiring. Normal actor code
/// should use [`DataActor`](crate::actor::DataActor) facade methods such as
/// `actor_id()`, `trader_id()`, `config()`, `clock()`, `cache()`, and the
/// subscription methods.
///
/// This macro only wires the data actor core. Components with a wider native
/// core, such as execution algorithms, keep their component-specific core
/// access behind their own native trait.
///
/// # Examples
///
/// ```ignore
/// use vibe_common::{vibe_actor, actor::DataActorCore};
///
/// pub struct MyActor {
///     core: DataActorCore,
///     // ...
/// }
///
/// vibe_actor!(MyActor);
/// ```
///
/// With a custom field name:
///
/// ```ignore
/// pub struct MyActor {
///     actor_core: DataActorCore,
///     // ...
/// }
///
/// vibe_actor!(MyActor, actor_core);
/// ```
#[macro_export]
macro_rules! vibe_actor {
    ($ty:ty) => {
        $crate::vibe_actor!($ty, core);
    };
    ($ty:ty, $field:ident) => {
        impl $crate::actor::DataActorNative for $ty {
            fn core(&self) -> &$crate::actor::DataActorCore {
                &self.$field
            }

            fn core_mut(&mut self) -> &mut $crate::actor::DataActorCore {
                &mut self.$field
            }
        }
    };
}
