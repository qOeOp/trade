import vibe_trader.network as network


def test_network_exposes_transport_backend_config_only() -> None:
    public_names = {name for name in vars(network) if not name.startswith("_")}

    assert public_names == {"TransportBackend"}
    assert network.TransportBackend.TUNGSTENITE != network.TransportBackend.SOCKUDO
