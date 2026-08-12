using System.Text;
using System.Text.Json;

namespace VoiceAttackBinaryDecoder;

internal static class Program
{
    private static int Main(string[] args)
    {
        try
        {
            var command = args.FirstOrDefault()?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(command))
            {
                WriteJson(new
                {
                    ok = false,
                    error = "No command supplied.",
                    supported_commands = new[] { "inspect" },
                });
                return 1;
            }

            switch (command)
            {
                case "inspect":
                    return RunInspect(args.Skip(1).ToArray());
                case "decode":
                    return RunDecode(args.Skip(1).ToArray());
                default:
                    WriteJson(new
                    {
                        ok = false,
                        error = $"Unsupported command: {command}",
                        supported_commands = new[] { "inspect", "decode" },
                    });
                    return 1;
            }
        }
        catch (Exception exception)
        {
            var rootException = exception;
            while (rootException.InnerException is not null)
            {
                rootException = rootException.InnerException;
            }

            WriteJson(new
            {
                ok = false,
                error = exception.Message,
                exception = exception.GetType().FullName,
                root_error = rootException.Message,
                root_exception = rootException.GetType().FullName,
            });
            return 1;
        }
    }

    private static int RunInspect(string[] args)
    {
        var options = InspectCommandOptions.Parse(args);
        var report = VoiceAttackAssemblyInspector.Inspect(options);
        WriteJson(report);
        return report.Ok ? 0 : 1;
    }

    private static int RunDecode(string[] args)
    {
        var options = DecodeCommandOptions.Parse(args);
        var report = VoiceAttackBinaryProfileDecoder.Decode(options);
        WriteJson(report);
        return report.Ok ? 0 : 1;
    }

    private static void WriteJson(object value)
    {
        var json = JsonSerializer.Serialize(
            value,
            new JsonSerializerOptions
            {
                WriteIndented = true,
            });
        Console.OutputEncoding = Encoding.UTF8;
        Console.WriteLine(json);
    }
}
