const api = typeof browser !== "undefined" ? browser : chrome;

document.getElementById("go").addEventListener("click", async () => {
  const val = document.getElementById("input").value || "";
  try {
    await api.runtime.sendMessage({ type: "BEGIN_SCRAPE", reportsRaw: val });
    window.close();
  } catch (e) {
    console.error(e);
    window.close();
  }
});
