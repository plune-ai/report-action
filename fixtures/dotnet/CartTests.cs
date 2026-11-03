using Xunit;
using Xunit.Abstractions;

namespace Cart.Tests;

// One passes with a file, one fails, one is skipped. The workflow sets RESULTS_DIR, the folder the JUnit
// report is written to: the marker's path counts from there.
public class CartTests(ITestOutputHelper output)
{
    [Fact]
    public void AddsAnItem()
    {
        var dir = Environment.GetEnvironmentVariable("RESULTS_DIR") ?? ".";
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "cart.txt"), "cart: 1 item\n");
        // xUnit v2 does not capture Console.WriteLine; ITestOutputHelper is what reaches the testcase's system-out.
        output.WriteLine("[[ATTACHMENT|cart.txt]]");
    }

    [Fact]
    public void TotalIsWrong() => Assert.Equal(4, 3);

    [Fact(Skip = "not ready")]
    public void AppliesACoupon() { }
}
