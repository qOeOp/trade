use pyo3_stub_gen::Result;

fn main() -> Result<()> {
    println!("Starting Python type stub generation...");

    let stub_info = vibe_pyo3::stub_info()?;
    stub_info.generate()?;

    println!("Python type stub generation completed");

    Ok(())
}
