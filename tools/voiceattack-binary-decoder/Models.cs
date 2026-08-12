namespace VoiceAttackBinaryDecoder;

internal sealed class VoiceAttackInspectReport
{
    public bool Ok { get; set; }

    public string? VoiceAttackDirectory { get; set; }

    public string? Error { get; set; }

    public List<AssemblyReport> Assemblies { get; set; } = new();

    public List<SerializerReferenceReport> SerializerReferences { get; set; } = new();

    public List<ZeroFormattableTypeReport> ZeroFormattableTypes { get; set; } = new();

    public List<LoaderMethodReport> LoaderMethods { get; set; } = new();

    public LoaderMethodReport? PreferredLoader { get; set; }

    public ZeroFormattableTypeReport? PreferredRootType { get; set; }
}

internal sealed class AssemblyReport
{
    public string Name { get; set; } = string.Empty;

    public string Path { get; set; } = string.Empty;

    public string Version { get; set; } = string.Empty;
}

internal sealed class SerializerReferenceReport
{
    public string AssemblyName { get; set; } = string.Empty;

    public string TypeName { get; set; } = string.Empty;

    public string Evidence { get; set; } = string.Empty;
}

internal sealed class ZeroFormattableTypeReport
{
    public string AssemblyName { get; set; } = string.Empty;

    public string TypeName { get; set; } = string.Empty;

    public bool IsPublic { get; set; }

    public bool IsClass { get; set; }

    public int IndexedMemberCount { get; set; }

    public int MaxIndex { get; set; }

    public List<IndexedMemberReport> IndexedMembers { get; set; } = new();
}

internal sealed class IndexedMemberReport
{
    public int Index { get; set; }

    public string MemberName { get; set; } = string.Empty;

    public string MemberType { get; set; } = string.Empty;

    public string MemberKind { get; set; } = string.Empty;
}

internal sealed class LoaderMethodReport
{
    public string AssemblyName { get; set; } = string.Empty;

    public string DeclaringType { get; set; } = string.Empty;

    public string MethodName { get; set; } = string.Empty;

    public string ReturnType { get; set; } = string.Empty;

    public List<string> ParameterTypes { get; set; } = new();

    public string SerializerMethod { get; set; } = string.Empty;

    public string RootType { get; set; } = string.Empty;

    public List<string> Evidence { get; set; } = new();
}
